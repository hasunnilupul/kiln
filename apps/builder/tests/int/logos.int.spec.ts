import { newClientConfig } from '@kiln/client-config'
import config from '@/payload.config'
import { saveConfig } from '@/endpoints/configs'
import { serveLogo, uploadLogo } from '@/endpoints/logos'
import { OWNER_SEED_CONTEXT } from '@/hooks/totp-login'
import type { Client, User } from '@/payload-types'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { callEndpoint } from '../helpers/endpoint'

/** Branding logo upload in the setup wizard (BR-11). */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const startedAt = new Date().toISOString()

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(run),
])
const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><title>${run}</title></svg>`)

let payload: Payload
let owner: User
let client: Client
let other: Client
let archived: Client

/** Calls the upload endpoint with `bytes` as the raw body, as the wizard sends it. */
async function upload(
  target: Client,
  bytes: Buffer,
  options: { user?: User | null; headers?: Record<string, string> } = {},
) {
  const user =
    options.user === null ? null : { ...(options.user ?? owner), collection: 'users' as const }
  const req = await createLocalReq({ user: user ?? undefined }, payload)
  req.user = user
  req.headers = new Headers({
    'content-type': 'image/png',
    'content-length': String(bytes.length),
    'x-file-name': 'Logo Final!.png',
    ...options.headers,
  })
  req.routeParams = { id: target.id }
  req.arrayBuffer = async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const response = await uploadLogo.handler(req)
  return { status: response.status, body: await response.json() }
}

async function serve(target: Client, path: string, user: User | null = owner) {
  const req = await createLocalReq(
    { user: user ? { ...user, collection: 'users' as const } : undefined },
    payload,
  )
  req.user = user ? { ...user, collection: 'users' as const } : null
  req.routeParams = { id: target.id }
  Object.assign(req, {
    url: `http://builder.test/api/clients/${target.id}/logo?path=${encodeURIComponent(path)}`,
  })
  return serveLogo.handler(req)
}

const makeClient = (name: string, status: 'active' | 'archived' = 'active') =>
  payload.create({
    collection: 'clients',
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${run}`, status },
    overrideAccess: true,
  })

const save = (logo?: string) => {
  const draft = newClientConfig({ id: 'x', slug: 'x', displayName: 'Logo Shop' })
  draft.admin = { email: 'admin@test.example', name: 'Admin' }
  if (logo) draft.branding.logo = logo
  return callEndpoint(payload, saveConfig, {
    user: owner,
    params: { id: client.id },
    body: { config: draft },
  })
}

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  owner = await payload.create({
    collection: 'users',
    data: { email: `logos-${run}@kiln.test`, password: 'correct-horse-battery-staple' },
    overrideAccess: true,
    context: { [OWNER_SEED_CONTEXT]: true },
  })
  client = await makeClient('Logo Shop')
  other = await makeClient('Other Logo Shop')
  archived = await makeClient('Archived Logo Shop', 'archived')
})

afterAll(async () => {
  const ids = [client.id, other.id, archived.id]
  for (const collection of ['logos', 'client-configs'] as const) {
    await payload.delete({ collection, where: { client: { in: ids } }, overrideAccess: true })
  }
  await payload.delete({
    collection: 'audit-log',
    where: { createdAt: { greater_than_equal: startedAt } },
    overrideAccess: true,
  })
  for (const id of ids) await payload.delete({ collection: 'clients', id, overrideAccess: true })
  await payload.delete({ collection: 'users', id: owner.id, overrideAccess: true })
})

describe('uploading a logo', () => {
  let path: string

  it('stores the image under a content-addressed path', async () => {
    const result = await upload(client, PNG)
    expect(result).toMatchObject({ status: 201, body: { mimeType: 'image/png', size: PNG.length } })
    path = result.body.path
    expect(path).toMatch(/^assets\/logo-[0-9a-f]{12}\.png$/)
    const { docs } = await payload.find({
      collection: 'logos',
      where: { client: { equals: client.id } },
      depth: 0,
      overrideAccess: true,
    })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ path, filename: 'Logo Final.png', uploadedBy: owner.id })
    // The file itself is not part of ordinary reads.
    expect(docs[0]).not.toHaveProperty('data')
  })

  it('keeps one copy of the same image and audits the first upload only', async () => {
    expect(await upload(client, PNG)).toMatchObject({ status: 201, body: { path } })
    const [logos, audit] = await Promise.all([
      payload.count({ collection: 'logos', where: { client: { equals: client.id } } }),
      payload.count({
        collection: 'audit-log',
        where: {
          and: [{ action: { equals: 'upload_logo' } }, { entityId: { equals: String(client.id) } }],
        },
      }),
    ])
    expect(logos.totalDocs).toBe(1)
    expect(audit.totalDocs).toBe(1)
  })

  it('refuses files that are not safe images, and oversized ones before reading them', async () => {
    expect(await upload(client, Buffer.from('GIF89a'))).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_logo' } },
    })
    expect(await upload(client, Buffer.from('<svg><script>alert(1)</script></svg>'))).toMatchObject(
      { status: 400, body: { error: { message: expect.stringContaining('scripts') } } },
    )
    expect(
      await upload(client, PNG, { headers: { 'content-length': String(600 * 1024) } }),
    ).toMatchObject({ status: 413 })
  })

  it('is for the signed-in owner and active clients only', async () => {
    expect(await upload(client, PNG, { user: null })).toMatchObject({ status: 401 })
    expect(await upload(archived, PNG)).toMatchObject({ status: 409 })
  })

  it('serves the image back to the owner only, so nothing in it can run', async () => {
    const response = await serve(client, path)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true)

    expect((await serve(client, path, null)).status).toBe(401)
    expect((await serve(other, path)).status).toBe(404)
    expect((await serve(client, '../../etc/passwd')).status).toBe(404)
  })

  it('accepts SVG logos', async () => {
    const result = await upload(client, SVG, { headers: { 'content-type': 'image/svg+xml' } })
    expect(result).toMatchObject({ status: 201, body: { mimeType: 'image/svg+xml' } })
    expect(result.body.path).toMatch(/\.svg$/)
  })

  it('lets a config version use an uploaded logo only', async () => {
    const missing = await save('assets/logo-000000000000.png')
    expect(missing).toMatchObject({
      status: 422,
      body: { error: { details: { issues: [{ path: ['branding', 'logo'] }] } } },
    })
    expect(await save(path)).toMatchObject({ status: 201 })
    const otherPath = (await upload(other, Buffer.concat([PNG, Buffer.from('x')]))).body.path
    expect(await save(otherPath)).toMatchObject({ status: 422 })
  })
})
