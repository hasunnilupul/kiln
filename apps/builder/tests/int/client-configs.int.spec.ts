import { newClientConfig } from '@kiln/client-config'
import config from '@/payload.config'
import { saveConfig } from '@/endpoints/configs'
import { OWNER_SEED_CONTEXT } from '@/hooks/totp-login'
import type { Client, User } from '@/payload-types'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { callEndpoint } from '../helpers/endpoint'

/** Clients (BR-10) and immutable, validated config versions (BR-12). */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const startedAt = new Date().toISOString()

let payload: Payload
let owner: User
let client: Client
const clients: Client[] = []

const validDraft = (overrides: { displayName?: string } = {}) => {
  const draft = newClientConfig({
    id: 'ignored',
    slug: 'ignored',
    displayName: overrides.displayName ?? 'Test Shop',
  })
  draft.admin = { email: 'admin@test.example', name: 'Admin' }
  return draft
}

const save = (
  target: Client,
  draft: unknown,
  note?: string,
  { anonymous = false }: { anonymous?: boolean } = {},
) =>
  callEndpoint(payload, saveConfig, {
    user: anonymous ? undefined : owner,
    params: { id: target.id },
    body: { config: draft, note },
  })

const makeClient = async (name: string) => {
  const doc = await payload.create({
    collection: 'clients',
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${run}`, status: 'active' },
    user: owner,
    overrideAccess: false,
  })
  clients.push(doc)
  return doc
}

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  owner = await payload.create({
    collection: 'users',
    data: { email: `configs-${run}@kiln.test`, password: 'correct-horse-battery-staple' },
    overrideAccess: true,
    context: { [OWNER_SEED_CONTEXT]: true },
  })
  client = await makeClient('Test Shop')
})

afterAll(async () => {
  const ids = clients.map((c) => c.id)
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

describe('clients (BR-10)', () => {
  it('get a stable client id that cannot be set or changed', async () => {
    expect(client.clientId).toMatch(/^cl_[a-z2-9]{12}$/)
    const updated = await payload.update({
      collection: 'clients',
      id: client.id,
      data: { clientId: 'cl_hijacked', notes: 'Prefers morning calls' },
      user: owner,
      overrideAccess: false,
    })
    expect(updated.clientId).toBe(client.clientId)
    expect(updated.notes).toBe('Prefers morning calls')
  })

  it('reject invalid and duplicate slugs', async () => {
    await expect(
      payload.create({
        collection: 'clients',
        data: { name: 'Bad', slug: 'Bad Slug', status: 'active' },
        user: owner,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'clients',
        data: { name: 'Dup', slug: client.slug, status: 'active' },
        user: owner,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('are never deleted, only archived', async () => {
    await expect(
      payload.delete({ collection: 'clients', id: client.id, user: owner, overrideAccess: false }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('config versions (BR-12)', () => {
  it('need a signed-in owner', async () => {
    expect(await save(client, validDraft(), undefined, { anonymous: true })).toMatchObject({
      status: 401,
    })
  })

  it('reject an invalid config with its issues and store nothing', async () => {
    const draft = validDraft()
    draft.tax.defaultRateCode = 'NONE'
    const result = await save(client, draft)
    expect(result).toMatchObject({ status: 422, body: { error: { code: 'invalid_config' } } })
    expect(result.body.error.details.issues).toEqual([
      expect.objectContaining({ path: ['tax', 'defaultRateCode'] }),
    ])
    expect(
      (
        await payload.count({
          collection: 'client-configs',
          where: { client: { equals: client.id } },
        })
      ).totalDocs,
    ).toBe(0)
  })

  it('store version 1 with the client record’s id and slug', async () => {
    const result = await save(client, validDraft(), 'First setup')
    expect(result).toMatchObject({ status: 201, body: { version: 1, created: true } })
    const stored = await payload.findByID({
      collection: 'client-configs',
      id: result.body.id,
      overrideAccess: true,
    })
    expect(stored).toMatchObject({ version: 1, note: 'First setup', label: `${client.slug} c1` })
    expect((stored.config as { client: unknown }).client).toMatchObject({
      id: client.clientId,
      slug: client.slug,
    })
  })

  it('do not add a version when nothing changed', async () => {
    expect(await save(client, validDraft())).toMatchObject({
      status: 200,
      body: { version: 1, created: false },
    })
  })

  it('number concurrent saves without gaps or duplicates', async () => {
    const results = await Promise.all([
      save(client, validDraft({ displayName: 'Shop A' })),
      save(client, validDraft({ displayName: 'Shop B' })),
    ])
    expect(results.map((r) => r.status)).toEqual([201, 201])
    expect(results.map((r) => r.body.version).sort()).toEqual([2, 3])
  })

  it('are immutable outside the endpoint', async () => {
    const { docs } = await payload.find({
      collection: 'client-configs',
      where: { client: { equals: client.id } },
      limit: 1,
      overrideAccess: true,
    })
    const version = docs[0]!
    await expect(
      payload.update({
        collection: 'client-configs',
        id: version.id,
        data: { note: 'edited' },
        user: owner,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      payload.delete({
        collection: 'client-configs',
        id: version.id,
        user: owner,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      payload.create({
        collection: 'client-configs',
        data: { client: client.id, version: 99, config: {} },
        user: owner,
        overrideAccess: false,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('are refused for archived clients', async () => {
    const archived = await makeClient('Closed Shop')
    await payload.update({
      collection: 'clients',
      id: archived.id,
      data: { status: 'archived' },
      user: owner,
      overrideAccess: false,
    })
    expect(await save(archived, validDraft())).toMatchObject({
      status: 409,
      body: { error: { code: 'client_archived' } },
    })
  })

  it('are audited', async () => {
    const audit = await payload.find({
      collection: 'audit-log',
      where: {
        and: [{ action: { equals: 'save_config' } }, { entityId: { equals: String(client.id) } }],
      },
      sort: 'createdAt',
      overrideAccess: true,
    })
    expect(audit.docs.map((entry) => (entry.data as { version: number }).version).sort()).toEqual([
      1, 2, 3,
    ])
    expect(audit.docs[0]!.actor).toMatchObject({ id: owner.id })
  })
})
