import { newClientConfig } from '@kiln/client-config'
import config from '@/payload.config'
import {
  buildCallback,
  buildJob,
  downloadBuild,
  expireStaleBuilds,
  triggerBuild,
} from '@/endpoints/builds'
import { saveConfig } from '@/endpoints/configs'
import { issueLicence } from '@/endpoints/licences'
import { OWNER_SEED_CONTEXT } from '@/hooks/totp-login'
import type { Client, User } from '@/payload-types'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { callEndpoint } from '../helpers/endpoint'

/** Builds: trigger (BR-20), signed workflow callbacks (BR-21, BR-22) and rebuilds (BR-24). */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const startedAt = new Date().toISOString()
const REPO = 'kiln-test/kiln'
const RUN_URL = `https://github.com/${REPO}/actions/runs/123456`
const SHA = 'a'.repeat(64)

let payload: Payload
let owner: User
let client: Client
let unlicensed: Client
const clients: Client[] = []
const savedEnv = { ...process.env }

/** GitHub as seen by the builder: tags to list, and the dispatches it received. */
const github = {
  tags: ['v1.1.0', 'v1.0.0'],
  dispatches: [] as { ref: string; inputs: Record<string, string> }[],
  failDispatch: false,
}

/** The R2 bucket as seen by the builder: object sizes by key. */
const bucket = new Map<string, number>()
const R2_HOST = 'r2acct.r2.cloudflarestorage.com'

beforeEach(() => {
  github.dispatches = []
  github.failDispatch = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (new URL(url).hostname.endsWith(R2_HOST) && init?.method === 'HEAD') {
      expect(url).toContain('X-Amz-Signature=')
      const path = decodeURIComponent(new URL(url).pathname)
      const key = [...bucket.keys()].find((candidate) => path.endsWith(`/${candidate}`))
      return key === undefined
        ? new Response(null, { status: 404 })
        : new Response(null, {
            status: 200,
            headers: { 'content-length': String(bucket.get(key)) },
          })
    }
    if (url === `https://api.github.com/repos/${REPO}/tags?per_page=100`) {
      return Response.json(github.tags.map((name) => ({ name })))
    }
    if (
      url === `https://api.github.com/repos/${REPO}/actions/workflows/build-client.yml/dispatches`
    ) {
      if (github.failDispatch) return new Response('Bad credentials', { status: 401 })
      github.dispatches.push(JSON.parse(String(init?.body)))
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const makeClient = async (name: string) => {
  const doc = await payload.create({
    collection: 'clients',
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${run}`, status: 'active' },
    overrideAccess: true,
  })
  clients.push(doc)
  const draft = newClientConfig({ id: 'x', slug: 'x', displayName: name })
  draft.admin = { email: 'admin@test.example', name: 'Admin' }
  await callEndpoint(payload, saveConfig, {
    user: owner,
    params: { id: doc.id },
    body: { config: draft },
  })
  return doc
}

const trigger = (target: Client, body: Record<string, unknown> = {}) =>
  callEndpoint(payload, triggerBuild, {
    user: owner,
    params: { id: target.id },
    body: { configVersion: 1, templateVersion: 'v1.1.0', ...body },
  })

/** Triggers a build and returns its id and the token the workflow received. */
const startBuild = async (body: Record<string, unknown> = {}) => {
  const result = await trigger(client, body)
  expect(result).toMatchObject({ status: 201, body: { status: 'queued' } })
  const dispatch = github.dispatches.at(-1)!
  expect(dispatch).toMatchObject({ ref: 'main', inputs: { build_id: String(result.body.id) } })
  return { id: result.body.id as number, token: dispatch.inputs.token! }
}

const asWorkflow = (endpoint: typeof buildJob, id: number, token: string, body?: unknown) =>
  callEndpoint(payload, endpoint, {
    params: { id },
    headers: { authorization: `Bearer ${token}` },
    body,
  })

const succeeded = (id: number, overrides: Record<string, unknown> = {}) => ({
  status: 'succeeded',
  runUrl: RUN_URL,
  zipKey: `builds/${client.slug}/${client.slug}-pos-v1.1.0-c1.zip`,
  zipName: `${client.slug}-pos-v1.1.0-c1.zip`,
  size: 52_428_800,
  sha256: SHA,
  commit: 'b'.repeat(40),
  templateVersion: 'v1.1.0',
  configVersion: 1,
  licenceId: licenceIdOf(id),
  ...overrides,
})

const licenceIds = new Map<number, string>()
const licenceIdOf = (id: number) => licenceIds.get(id)!

beforeAll(async () => {
  Object.assign(process.env, {
    GITHUB_TOKEN: 'test-token',
    GITHUB_REPOSITORY: REPO,
    BUILDER_PUBLIC_URL: 'https://builder.example/',
    R2_ACCOUNT_ID: 'r2acct',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_BUCKET: 'kiln-builds',
  })
  payload = await getPayload({ config: await config })
  owner = await payload.create({
    collection: 'users',
    data: { email: `builds-${run}@kiln.test`, password: 'correct-horse-battery-staple' },
    overrideAccess: true,
    context: { [OWNER_SEED_CONTEXT]: true },
  })
  client = await makeClient('Build Shop')
  unlicensed = await makeClient('Unlicensed Shop')
  await callEndpoint(payload, issueLicence, {
    user: owner,
    params: { id: client.id },
    body: { term: '12m', allowedHosts: ['pos.build-shop.example'], modules: [], maxRegisters: 1 },
  })
})

afterAll(async () => {
  process.env = savedEnv
  const ids = clients.map((c) => c.id)
  await payload.update({
    collection: 'builds',
    where: { client: { in: ids } },
    data: { rebuildOf: null },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'builds',
    where: { client: { in: ids } },
    overrideAccess: true,
  })
  await payload.update({
    collection: 'licences',
    where: { client: { in: ids } },
    data: { supersededBy: null },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'licences',
    where: { client: { in: ids } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'client-configs',
    where: { client: { in: ids } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'audit-log',
    where: { createdAt: { greater_than_equal: startedAt } },
    overrideAccess: true,
  })
  for (const id of ids) await payload.delete({ collection: 'clients', id, overrideAccess: true })
  await payload.delete({ collection: 'users', id: owner.id, overrideAccess: true })
})

describe('triggering a build (BR-20)', () => {
  it('explains what is missing when builds are not configured', async () => {
    const token = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      expect(await trigger(client)).toMatchObject({
        status: 503,
        body: {
          error: {
            code: 'builds_not_configured',
            message: expect.stringContaining('GITHUB_TOKEN'),
          },
        },
      })
    } finally {
      process.env.GITHUB_TOKEN = token
    }
  })

  it('needs a current licence, an existing config version and a known template tag', async () => {
    expect(await trigger(unlicensed)).toMatchObject({
      status: 409,
      body: { error: { code: 'no_licence' } },
    })
    expect(await trigger(client, { configVersion: 9 })).toMatchObject({ status: 404 })
    expect(await trigger(client, { templateVersion: 'v9.9.9' })).toMatchObject({
      status: 400,
      body: { error: { code: 'unknown_template_version' } },
    })
    expect(await trigger(client, { templateVersion: 'main; rm -rf /' })).toMatchObject({
      status: 400,
    })
    expect(github.dispatches).toHaveLength(0)
  })

  it('queues the build with the current licence and dispatches the workflow', async () => {
    const { id } = await startBuild()
    const build = await payload.findByID({ collection: 'builds', id, overrideAccess: true })
    expect(build).toMatchObject({ status: 'queued', templateVersion: 'v1.1.0', configNumber: 1 })
    expect(build.licenceId).toMatch(/^lic_/)
  })

  it('marks the build failed when GitHub refuses the dispatch', async () => {
    github.failDispatch = true
    const result = await trigger(client)
    expect(result).toMatchObject({ status: 502, body: { error: { code: 'dispatch_failed' } } })
    const { docs } = await payload.find({
      collection: 'builds',
      where: { client: { equals: client.id } },
      sort: '-createdAt',
      limit: 1,
      overrideAccess: true,
    })
    expect(docs[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('401') })
  })
})

describe('the workflow (BR-21, BR-22)', () => {
  let build: { id: number; token: string }

  beforeAll(async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tags?per_page=100'))
        return Response.json(github.tags.map((name) => ({ name })))
      github.dispatches.push(JSON.parse(String(init?.body)))
      return new Response(null, { status: 204 })
    })
    build = await startBuild()
    const stored = await payload.findByID({
      collection: 'builds',
      id: build.id,
      overrideAccess: true,
    })
    licenceIds.set(build.id, stored.licenceId)
    vi.restoreAllMocks()
  })

  it('refuses requests without the token for this build', async () => {
    expect(await asWorkflow(buildJob, build.id, 'forged')).toMatchObject({ status: 401 })
    const other = await startBuild()
    expect(await asWorkflow(buildJob, build.id, other.token)).toMatchObject({ status: 401 })
    expect(await callEndpoint(payload, buildJob, { params: { id: build.id } })).toMatchObject({
      status: 401,
    })
  })

  it('fetches the job: config, licence, public key and where to report', async () => {
    const job = await asWorkflow(buildJob, build.id, build.token)
    expect(job).toMatchObject({
      status: 200,
      body: {
        buildId: build.id,
        clientSlug: client.slug,
        templateVersion: 'v1.1.0',
        configVersion: 1,
        config: { client: { id: client.clientId, slug: client.slug } },
        licence: { alg: 'Ed25519' },
        publicKey: expect.stringContaining('BEGIN PUBLIC KEY'),
        licenceServer: 'https://builder.example',
        zipKeyPrefix: `builds/${client.slug}/`,
      },
    })
  })

  it('moves to building with a run of this repository only', async () => {
    expect(
      await asWorkflow(buildCallback, build.id, build.token, {
        status: 'building',
        runUrl: 'https://evil.example/actions/runs/1',
      }),
    ).toMatchObject({ status: 400, body: { error: { code: 'invalid_run_url' } } })
    expect(
      await asWorkflow(buildCallback, build.id, build.token, {
        status: 'building',
        runUrl: RUN_URL,
      }),
    ).toMatchObject({ status: 200 })
    expect(
      await asWorkflow(buildCallback, build.id, build.token, {
        status: 'building',
        runUrl: RUN_URL,
      }),
    ).toMatchObject({ status: 409 })
  })

  it('rejects a result that is not the requested build', async () => {
    for (const overrides of [
      { templateVersion: 'v1.0.0' },
      { configVersion: 2 },
      { licenceId: 'lic_other' },
      { zipKey: 'builds/another-client/x.zip' },
      { sha256: 'not-a-hash' },
    ]) {
      expect(
        await asWorkflow(buildCallback, build.id, build.token, succeeded(build.id, overrides)),
      ).toMatchObject({ status: 400 })
    }
  })

  it('accepts success only once the zip is in the bucket at its reported size', async () => {
    const result = succeeded(build.id)
    expect(await asWorkflow(buildCallback, build.id, build.token, result)).toMatchObject({
      status: 400,
      body: { error: { code: 'upload_missing', message: 'The zip is not in the build bucket' } },
    })
    bucket.set(result.zipKey as string, 1234)
    expect(await asWorkflow(buildCallback, build.id, build.token, result)).toMatchObject({
      status: 400,
      body: { error: { code: 'upload_missing', message: expect.stringContaining('1234 bytes') } },
    })
    bucket.set(result.zipKey as string, result.size as number)
  })

  it('records the zip, size and checksum, then is final', async () => {
    expect(
      await asWorkflow(buildCallback, build.id, build.token, succeeded(build.id)),
    ).toMatchObject({
      status: 200,
      body: { status: 'succeeded' },
    })
    const stored = await payload.findByID({
      collection: 'builds',
      id: build.id,
      overrideAccess: true,
    })
    expect(stored).toMatchObject({
      status: 'succeeded',
      runUrl: RUN_URL,
      zipName: `${client.slug}-pos-v1.1.0-c1.zip`,
      size: 52_428_800,
      sha256: SHA,
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
    })
    expect(
      await asWorkflow(buildCallback, build.id, build.token, { status: 'failed', error: 'late' }),
    ).toMatchObject({ status: 409 })
    expect(await asWorkflow(buildJob, build.id, build.token)).toMatchObject({ status: 409 })
  })
})

describe('downloads (BR-23)', () => {
  let done: number
  let queued: number

  beforeAll(async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tags?per_page=100'))
        return Response.json(github.tags.map((name) => ({ name })))
      if (new URL(url).hostname.endsWith(R2_HOST)) {
        return new Response(null, { status: 200, headers: { 'content-length': '52428800' } })
      }
      github.dispatches.push(JSON.parse(String(init?.body)))
      return new Response(null, { status: 204 })
    })
    const build = await startBuild()
    const stored = await payload.findByID({
      collection: 'builds',
      id: build.id,
      overrideAccess: true,
    })
    licenceIds.set(build.id, stored.licenceId)
    await asWorkflow(buildCallback, build.id, build.token, { status: 'building', runUrl: RUN_URL })
    const result = await asWorkflow(buildCallback, build.id, build.token, succeeded(build.id))
    expect(result).toMatchObject({ status: 200 })
    done = build.id
    queued = (await startBuild()).id
    vi.restoreAllMocks()
  })

  const download = (id: number, user: User | null = owner) =>
    callEndpoint(payload, downloadBuild, { user: user ?? undefined, params: { id } })

  it('is for the signed-in owner only', async () => {
    expect(await download(done, null)).toMatchObject({ status: 401 })
  })

  it('only offers succeeded builds', async () => {
    expect(await download(queued)).toMatchObject({
      status: 409,
      body: { error: { code: 'not_downloadable' } },
    })
    expect(await download(999_999_999)).toMatchObject({ status: 404 })
  })

  it('returns a 15-minute signed link that saves the zip under its name', async () => {
    const before = Date.now()
    const result = await download(done)
    expect(result).toMatchObject({
      status: 200,
      body: { zipName: `${client.slug}-pos-v1.1.0-c1.zip`, sha256: SHA },
    })
    expect(result.headers.get('cache-control')).toBe('no-store')
    const url = new URL(result.body.url)
    expect(url.hostname).toContain(R2_HOST)
    expect(decodeURIComponent(url.pathname)).toContain(
      `builds/${client.slug}/${client.slug}-pos-v1.1.0-c1.zip`,
    )
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="${client.slug}-pos-v1.1.0-c1.zip"`,
    )
    expect(url.searchParams.get('X-Amz-Credential')).not.toContain('test-secret-key')
    const expiresAt = Date.parse(result.body.expiresAt)
    expect(expiresAt - before).toBeGreaterThanOrEqual(15 * 60 * 1000)
    expect(expiresAt - before).toBeLessThan(16 * 60 * 1000)
  })

  it('logs every download with the owner', async () => {
    await download(done)
    const { docs } = await payload.find({
      collection: 'audit-log',
      where: {
        and: [{ action: { equals: 'download_build' } }, { entityId: { equals: String(done) } }],
      },
      depth: 0,
      overrideAccess: true,
    })
    expect(docs.length).toBeGreaterThanOrEqual(2)
    expect(docs[0]).toMatchObject({
      entity: 'builds',
      actor: owner.id,
      data: { clientId: client.id, sha256: SHA },
    })
  })

  it('explains what is missing when storage is not configured', async () => {
    const bucketName = process.env.R2_BUCKET
    delete process.env.R2_BUCKET
    try {
      expect(await download(done)).toMatchObject({
        status: 503,
        body: {
          error: { code: 'storage_not_configured', message: expect.stringContaining('R2_BUCKET') },
        },
      })
    } finally {
      process.env.R2_BUCKET = bucketName
    }
  })
})

describe('failures, rebuilds and stale builds', () => {
  it('records a failure reported by the workflow', async () => {
    const { id, token } = await startBuild()
    expect(
      await asWorkflow(buildCallback, id, token, {
        status: 'failed',
        runUrl: RUN_URL,
        error: 'next build failed',
      }),
    ).toMatchObject({ status: 200 })
    expect(
      await payload.findByID({ collection: 'builds', id, overrideAccess: true }),
    ).toMatchObject({
      status: 'failed',
      error: 'next build failed',
    })
  })

  it('rebuilds an earlier build of the same client only (BR-24)', async () => {
    const { id } = await startBuild()
    const rebuild = await startBuild({ rebuildOf: id, templateVersion: 'v1.0.0' })
    expect(
      await payload.findByID({
        collection: 'builds',
        id: rebuild.id,
        depth: 0,
        overrideAccess: true,
      }),
    ).toMatchObject({
      rebuildOf: id,
      templateVersion: 'v1.0.0',
    })
    const other = await makeClient('Other Build Shop')
    await callEndpoint(payload, issueLicence, {
      user: owner,
      params: { id: other.id },
      body: { term: 'trial', allowedHosts: ['pos.other.example'], modules: [], maxRegisters: 1 },
    })
    expect(await trigger(other, { rebuildOf: id })).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_rebuild' } },
    })
  })

  it('fails builds that never reported back once their token expires', async () => {
    const stale = await payload.create({
      collection: 'builds',
      data: {
        client: client.id,
        status: 'building',
        configVersion: (
          await payload.find({
            collection: 'client-configs',
            where: { client: { equals: client.id } },
            overrideAccess: true,
          })
        ).docs[0]!.id,
        configNumber: 1,
        templateVersion: 'v1.0.0',
        licenceId: 'lic_x',
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      },
      overrideAccess: true,
    })
    await expireStaleBuilds(await createLocalReq({}, payload), client.id)
    expect(
      await payload.findByID({ collection: 'builds', id: stale.id, overrideAccess: true }),
    ).toMatchObject({
      status: 'failed',
      error: 'The build workflow did not report back in time',
    })
  })

  it('audits triggers, rebuilds and results', async () => {
    const audit = await payload.find({
      collection: 'audit-log',
      where: {
        and: [
          { entityId: { equals: String(client.id) } },
          { action: { in: ['trigger_build', 'rebuild', 'build_succeeded', 'build_failed'] } },
        ],
      },
      pagination: false,
      overrideAccess: true,
    })
    const actions = new Set(audit.docs.map((entry) => entry.action))
    expect(actions).toEqual(
      new Set(['trigger_build', 'rebuild', 'build_succeeded', 'build_failed']),
    )
  })
})
