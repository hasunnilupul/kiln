import { licenceFileSchema } from '@kiln/licence'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { writeAudit } from '../hooks/audit'
import { execute, sql } from '../lib/db'
import {
  BuildsNotConfigured,
  TEMPLATE_VERSION_PATTERN,
  dispatchBuild,
  githubSettings,
  listTemplateVersions,
  type GitHubSettings,
} from '../lib/github'
import { licenceKeys } from '../lib/licence-key'
import {
  DOWNLOAD_URL_TTL_SECONDS,
  R2_VARIABLES,
  objectSize,
  r2Settings,
  signedDownloadUrl,
  type R2Settings,
} from '../lib/r2'
import { signToken, verifyToken } from '../lib/secrets'
import type { Build } from '../payload-types'
import { ApiError, inTransaction, jsonEndpoint, requireOwner, routeId } from './http'
import { currentLicence } from './licences'
import { findLogo } from './logos'

/** How long the workflow may take, from dispatch to its last callback. */
export const BUILD_TOKEN_TTL_SECONDS = 3 * 60 * 60
const BUILD_TOKEN_PURPOSE = 'build-job'

/** Everything a build needs from the environment, or a clear "not configured" error. */
export function buildSetup(env: NodeJS.ProcessEnv = process.env): {
  github: GitHubSettings
  publicUrl: string
  r2: R2Settings
} {
  const missing = [
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'BUILDER_PUBLIC_URL',
    ...R2_VARIABLES,
  ].filter((name) => !env[name]?.trim())
  if (missing.length > 0) throw new BuildsNotConfigured(missing)
  return {
    github: githubSettings(env),
    // The URL client builds check their licence in with, and the workflow calls back.
    publicUrl: env.BUILDER_PUBLIC_URL!.trim().replace(/\/+$/, ''),
    r2: r2Settings(env),
  }
}

function setupOrFail(): ReturnType<typeof buildSetup> {
  try {
    return buildSetup()
  } catch (error) {
    throw new ApiError(503, 'builds_not_configured', (error as Error).message)
  }
}

/** The bearer token on a workflow request, valid only for build `buildId`. */
function requireBuildToken(req: PayloadRequest, buildId: number): void {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const claims = token ? verifyToken(token, req.payload.secret, BUILD_TOKEN_PURPOSE) : null
  if (!claims || claims.buildId !== buildId) {
    throw new ApiError(
      401,
      'invalid_build_token',
      'Build token missing, expired or for another build',
    )
  }
}

async function findBuild(req: PayloadRequest, id: number): Promise<Build> {
  const build = await req.payload
    .findByID({ collection: 'builds', id, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  if (!build) throw new ApiError(404, 'build_not_found', 'Build not found')
  return build
}

const relId = (value: number | { id: number } | null | undefined) =>
  value === null || value === undefined ? null : typeof value === 'object' ? value.id : value

/**
 * Marks builds that never reported back as failed once their token has expired, so nothing stays
 * "building" forever. Called when build history is shown.
 */
export async function expireStaleBuilds(req: PayloadRequest, clientId: number): Promise<void> {
  const cutoff = new Date(Date.now() - BUILD_TOKEN_TTL_SECONDS * 1000).toISOString()
  await req.payload.update({
    collection: 'builds',
    where: {
      and: [
        { client: { equals: clientId } },
        { status: { in: ['queued', 'building'] } },
        { createdAt: { less_than: cutoff } },
      ],
    },
    data: {
      status: 'failed',
      error: 'The build workflow did not report back in time',
      finishedAt: new Date().toISOString(),
    },
    overrideAccess: true,
    req,
  })
}

const triggerBody = z.object({
  configVersion: z.int().min(1),
  templateVersion: z.string().regex(TEMPLATE_VERSION_PATTERN, 'Not a template version'),
  /** For BR-24: the earlier build this one repeats, with any config version. */
  rebuildOf: z.int().positive().optional(),
})

/**
 * `POST /api/clients/:id/builds`: build a config version on a template version (BR-20, BR-24).
 * Ships the client's current licence; dispatches the GitHub workflow, which reports back.
 */
export const triggerBuild = jsonEndpoint({
  method: 'post',
  path: '/:id/builds',
  body: triggerBody,
  status: 201,
  handler: async (req, body) => {
    const owner = requireOwner(req)
    const clientId = routeId(req)
    const setup = setupOrFail()

    const client = await req.payload
      .findByID({ collection: 'clients', id: clientId, depth: 0, overrideAccess: true, req })
      .catch(() => null)
    if (!client) throw new ApiError(404, 'client_not_found', 'Client not found')
    if (client.status === 'archived') {
      throw new ApiError(409, 'client_archived', 'This client is archived')
    }

    const { docs: configs } = await req.payload.find({
      collection: 'client-configs',
      where: {
        and: [{ client: { equals: clientId } }, { version: { equals: body.configVersion } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const config = configs[0]
    if (!config)
      throw new ApiError(404, 'config_not_found', `No config version c${body.configVersion}`)

    const licence = await currentLicence(req, clientId)
    if (!licence) {
      throw new ApiError(409, 'no_licence', 'Issue or renew a licence before building')
    }
    if (body.rebuildOf) {
      const original = await findBuild(req, body.rebuildOf)
      if (relId(original.client) !== clientId) {
        throw new ApiError(400, 'invalid_rebuild', 'That build belongs to another client')
      }
    }

    const versions = await listTemplateVersions(setup.github).catch((error: unknown) => {
      throw new ApiError(
        502,
        'github_unavailable',
        `Could not list template versions: ${(error as Error).message}`,
      )
    })
    if (!versions.includes(body.templateVersion)) {
      throw new ApiError(
        400,
        'unknown_template_version',
        `No template version ${body.templateVersion}`,
      )
    }

    const build = await req.payload.create({
      collection: 'builds',
      data: {
        client: clientId,
        label: `${client.slug} ${body.templateVersion} c${body.configVersion}`,
        status: 'queued',
        configVersion: config.id,
        configNumber: config.version,
        templateVersion: body.templateVersion,
        licenceId: licence.licenceId,
        requestedBy: owner.id,
        rebuildOf: body.rebuildOf,
      },
      overrideAccess: true,
      req,
    })
    await writeAudit(req, {
      action: body.rebuildOf ? 'rebuild' : 'trigger_build',
      entity: 'clients',
      entityId: clientId,
      data: {
        buildId: build.id,
        templateVersion: body.templateVersion,
        configVersion: body.configVersion,
        licenceId: licence.licenceId,
        rebuildOf: body.rebuildOf ?? null,
      },
    })

    const token = signToken(
      { buildId: build.id },
      req.payload.secret,
      BUILD_TOKEN_PURPOSE,
      BUILD_TOKEN_TTL_SECONDS,
    )
    try {
      await dispatchBuild(setup.github, { buildId: build.id, token })
    } catch (error) {
      await req.payload.update({
        collection: 'builds',
        id: build.id,
        data: {
          status: 'failed',
          error: `Could not start the workflow: ${(error as Error).message}`.slice(0, 1000),
          finishedAt: new Date().toISOString(),
        },
        overrideAccess: true,
        req,
      })
      throw new ApiError(502, 'dispatch_failed', 'GitHub did not start the build workflow')
    }
    return { id: build.id, status: 'queued' }
  },
})

/**
 * `GET /api/builds/:id/job`: what the workflow builds (pipeline step 1). Authenticated by the
 * build token, and only while the build is still running.
 */
export const buildJob = jsonEndpoint({
  method: 'get',
  path: '/:id/job',
  handler: async (req) => {
    const id = routeId(req)
    requireBuildToken(req, id)
    const setup = setupOrFail()
    const build = await findBuild(req, id)
    if (build.status !== 'queued' && build.status !== 'building') {
      throw new ApiError(409, 'build_finished', `This build has already ${build.status}`)
    }
    const [client, config, licences] = await Promise.all([
      req.payload.findByID({
        collection: 'clients',
        id: relId(build.client)!,
        depth: 0,
        overrideAccess: true,
        req,
      }),
      req.payload.findByID({
        collection: 'client-configs',
        id: relId(build.configVersion)!,
        depth: 0,
        overrideAccess: true,
        req,
      }),
      req.payload.find({
        collection: 'licences',
        where: { licenceId: { equals: build.licenceId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req,
      }),
    ])
    const licence = licences.docs[0]
    if (!licence) throw new ApiError(409, 'licence_missing', `Licence ${build.licenceId} not found`)
    // Branding assets the config points at, written next to client.config.json by the workflow.
    const assets: { path: string; sha256: string; base64: string }[] = []
    const logoPath = (config.config as { branding?: { logo?: string } }).branding?.logo
    if (logoPath) {
      const logo = await findLogo(req, client.id, logoPath)
      if (!logo) throw new ApiError(409, 'logo_missing', `Logo ${logoPath} not found`)
      assets.push({ path: logo.path, sha256: logo.sha256, base64: logo.data })
    }
    return {
      buildId: build.id,
      clientSlug: client.slug,
      templateVersion: build.templateVersion,
      configVersion: build.configNumber,
      config: config.config,
      assets,
      licence: licenceFileSchema.parse(licence.file),
      publicKey: licenceKeys().publicKeyPem,
      licenceServer: setup.publicUrl,
      zipKeyPrefix: `builds/${client.slug}/`,
    }
  },
})

const runUrl = z.url().max(500)

const callbackBody = z.discriminatedUnion('status', [
  z.object({ status: z.literal('building'), runUrl }),
  z.object({
    status: z.literal('succeeded'),
    runUrl: runUrl.optional(),
    zipKey: z.string().min(1).max(500),
    zipName: z
      .string()
      .regex(/^[\w.-]+\.zip$/)
      .max(200),
    size: z.int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    templateVersion: z.string(),
    configVersion: z.int(),
    licenceId: z.string(),
  }),
  z.object({
    status: z.literal('failed'),
    runUrl: runUrl.optional(),
    error: z.string().trim().min(1).max(1000),
  }),
])

/**
 * `POST /api/builds/:id/callback`: the workflow reports progress (BR-21) and, on success, what it
 * built (BR-22). Only forward moves are accepted; a finished build is final.
 */
export const buildCallback = jsonEndpoint({
  method: 'post',
  path: '/:id/callback',
  body: callbackBody,
  handler: async (req, body) => {
    const id = routeId(req)
    requireBuildToken(req, id)
    const setup = setupOrFail()
    if (
      body.runUrl &&
      !body.runUrl.startsWith(`https://github.com/${setup.github.repository}/actions/runs/`)
    ) {
      throw new ApiError(400, 'invalid_run_url', 'Not a run of the build workflow')
    }

    return inTransaction(req, async () => {
      // One callback at a time per build, so a late "building" cannot overwrite "succeeded".
      await execute(req, sql`select id from builds where id = ${id} for update`)
      const build = await findBuild(req, id)
      if (build.status === 'succeeded' || build.status === 'failed') {
        throw new ApiError(409, 'build_finished', `This build has already ${build.status}`)
      }
      const client = await req.payload.findByID({
        collection: 'clients',
        id: relId(build.client)!,
        depth: 0,
        overrideAccess: true,
        req,
      })
      const now = new Date().toISOString()
      let data: Partial<Build>

      if (body.status === 'building') {
        if (build.status !== 'queued')
          throw new ApiError(409, 'already_building', 'Already building')
        data = { status: 'building', runUrl: body.runUrl, startedAt: now }
      } else if (body.status === 'succeeded') {
        const mismatch =
          body.templateVersion !== build.templateVersion ||
          body.configVersion !== build.configNumber ||
          body.licenceId !== build.licenceId ||
          body.zipKey !== `builds/${client.slug}/${body.zipName}`
        if (mismatch) {
          throw new ApiError(
            400,
            'result_mismatch',
            'The result does not match the requested build',
          )
        }
        // Only a zip that actually reached the bucket can be downloaded later (BR-23).
        const stored = await objectSize(setup.r2, body.zipKey).catch((error: unknown) => {
          throw new ApiError(
            502,
            'storage_unavailable',
            `Could not check the upload: ${(error as Error).message}`,
          )
        })
        if (stored !== body.size) {
          throw new ApiError(
            400,
            'upload_missing',
            stored === null
              ? 'The zip is not in the build bucket'
              : `The stored zip is ${stored} bytes, not ${body.size}`,
          )
        }
        data = {
          status: 'succeeded',
          runUrl: body.runUrl ?? build.runUrl,
          finishedAt: now,
          zipKey: body.zipKey,
          zipName: body.zipName,
          size: body.size,
          sha256: body.sha256,
          commit: body.commit,
        }
      } else {
        data = {
          status: 'failed',
          runUrl: body.runUrl ?? build.runUrl,
          finishedAt: now,
          error: body.error,
        }
      }

      await req.payload.update({ collection: 'builds', id, data, overrideAccess: true, req })
      if (body.status !== 'building') {
        await writeAudit(req, {
          action: `build_${body.status}`,
          entity: 'clients',
          entityId: client.id,
          actor: null,
          data: {
            buildId: id,
            ...(body.status === 'succeeded'
              ? { zipName: body.zipName, size: body.size, sha256: body.sha256 }
              : { error: body.error }),
          },
        })
      }
      return { id, status: body.status }
    })
  },
})

/**
 * `POST /api/builds/:id/download`: a signed R2 link to a succeeded build's zip, valid for 15
 * minutes (BR-23). Every link handed out is written to the audit log with the owner and IP.
 */
export const downloadBuild = jsonEndpoint({
  method: 'post',
  path: '/:id/download',
  handler: async (req) => {
    requireOwner(req)
    const id = routeId(req)
    const missing = R2_VARIABLES.filter((name) => !process.env[name]?.trim())
    if (missing.length > 0) {
      throw new ApiError(
        503,
        'storage_not_configured',
        `Build downloads are not configured: set ${missing.join(', ')}`,
      )
    }
    const build = await findBuild(req, id)
    if (build.status !== 'succeeded' || !build.zipKey || !build.zipName) {
      throw new ApiError(409, 'not_downloadable', 'Only succeeded builds can be downloaded')
    }

    const url = await signedDownloadUrl(r2Settings(), build.zipKey, build.zipName)
    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString()
    await writeAudit(req, {
      action: 'download_build',
      entity: 'builds',
      entityId: id,
      data: {
        clientId: relId(build.client),
        zipName: build.zipName,
        sha256: build.sha256,
        expiresAt,
      },
    })
    return Response.json(
      { url, expiresAt, zipName: build.zipName, sha256: build.sha256 },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  },
})
