import { diffClientConfigs, safeParseClientConfig } from '@kiln/client-config'
import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { z } from 'zod'

import { writeAudit } from '../hooks/audit'
import { execute, sql } from '../lib/db'
import type { Client, ClientConfig as ConfigVersion } from '../payload-types'
import { ApiError, jsonEndpoint, requireOwner, routeId, type OwnerUser } from './http'
import { findLogo } from './logos'

const saveBody = z.object({
  config: z.unknown(),
  note: z.string().trim().max(200).optional(),
})

/** The client's newest config version, or null before the first save. */
export async function latestConfig(
  req: PayloadRequest,
  clientId: number,
): Promise<ConfigVersion | null> {
  const result = await req.payload.find({
    collection: 'client-configs',
    where: { client: { equals: clientId } },
    sort: '-version',
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return result.docs[0] ?? null
}

/**
 * Validates `input` as the client's config and stores it as the next version (BR-12). The
 * config's `client.id` and `client.slug` always come from the client record. An unchanged config
 * returns the latest version instead of adding a duplicate.
 */
export async function saveConfigVersion(
  req: PayloadRequest,
  owner: OwnerUser,
  clientId: number,
  input: unknown,
  note?: string,
): Promise<{ version: ConfigVersion; created: boolean }> {
  const ownsTransaction = await initTransaction(req)
  try {
    // Serialises saves for one client, so two saves cannot take the same version number.
    const locked = await execute(req, sql`select id from clients where id = ${clientId} for update`)
    if (locked.length !== 1) throw new ApiError(404, 'client_not_found', 'Client not found')
    const client: Client = await req.payload.findByID({
      collection: 'clients',
      id: clientId,
      depth: 0,
      overrideAccess: true,
      req,
    })
    if (client.status === 'archived') {
      throw new ApiError(409, 'client_archived', 'This client is archived')
    }

    const draft =
      typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
    const draftClient =
      typeof draft.client === 'object' && draft.client !== null ? draft.client : {}
    const parsed = safeParseClientConfig({
      ...draft,
      client: { ...draftClient, id: client.clientId, slug: client.slug },
    })
    if (!parsed.success) {
      throw new ApiError(422, 'invalid_config', 'The config is invalid', {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      })
    }

    // A logo must have been uploaded for this client, so every saved version can be built.
    const logo = parsed.config.branding.logo
    if (logo && !(await findLogo(req, clientId, logo))) {
      throw new ApiError(422, 'invalid_config', 'The config is invalid', {
        details: {
          issues: [{ path: ['branding', 'logo'], message: 'Upload the logo in the Branding step' }],
        },
      })
    }

    const latest = await latestConfig(req, clientId)
    // Compared structurally: jsonb does not keep key order, so the stored text differs.
    if (latest && diffClientConfigs(latest.config, parsed.config).length === 0) {
      if (ownsTransaction) await commitTransaction(req)
      return { version: latest, created: false }
    }

    const number = (latest?.version ?? 0) + 1
    const version = await req.payload.create({
      collection: 'client-configs',
      data: {
        client: clientId,
        version: number,
        label: `${client.slug} c${number}`,
        config: parsed.config,
        note: note || undefined,
        createdBy: owner.id,
      },
      overrideAccess: true,
      req,
    })
    await writeAudit(req, {
      action: 'save_config',
      entity: 'clients',
      entityId: clientId,
      data: { version: number, note: note ?? null },
    })
    if (ownsTransaction) await commitTransaction(req)
    return { version, created: true }
  } catch (error) {
    if (ownsTransaction) await killTransaction(req)
    throw error
  }
}

/**
 * `POST /api/clients/:id/configs`: save the wizard's config as a new version (BR-11, BR-12).
 * A `clients` collection endpoint, so Payload routes it alongside the collection's own routes.
 */
export const saveConfig = jsonEndpoint({
  method: 'post',
  path: '/:id/configs',
  body: saveBody,
  handler: async (req, body) => {
    const owner = requireOwner(req)
    const { version, created } = await saveConfigVersion(
      req,
      owner,
      routeId(req),
      body.config,
      body.note,
    )
    return Response.json(
      { id: version.id, version: version.version, created },
      { status: created ? 201 : 200 },
    )
  },
})
