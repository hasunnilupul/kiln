import { licenceFileSchema, type LicenceFile } from '@kiln/licence'
import { generateLicenceKeyPair, signLicence } from '@kiln/licence/sign'
import { verifyLicence, verifyLicenceStatus } from '@kiln/licence/verify'
import config from '@/payload.config'
import { downloadLicence, issueLicence, licenceCheck, revokeLicence } from '@/endpoints/licences'
import { OWNER_SEED_CONTEXT } from '@/hooks/totp-login'
import { licenceKeys } from '@/lib/licence-key'
import type { Client, User } from '@/payload-types'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { callEndpoint } from '../helpers/endpoint'

/** Licence issuing, renewal, revocation (BR-30 to BR-32) and POS check-ins. */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const startedAt = new Date().toISOString()
const host = `pos-${run}.example.com`

let payload: Payload
let owner: User
let client: Client
const clients: Client[] = []

const makeClient = async (name: string, status: 'active' | 'archived' = 'active') => {
  const doc = await payload.create({
    collection: 'clients',
    data: { name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${run}`, status },
    overrideAccess: true,
  })
  clients.push(doc)
  return doc
}

const issue = (target: Client, overrides: Record<string, unknown> = {}) =>
  callEndpoint(payload, issueLicence, {
    user: owner,
    params: { id: target.id },
    body: {
      term: '12m',
      allowedHosts: [host],
      modules: ['inventory'],
      maxRegisters: 2,
      ...overrides,
    },
  })

const fileOf = async (id: number): Promise<LicenceFile> => {
  const doc = await payload.findByID({ collection: 'licences', id, overrideAccess: true })
  return licenceFileSchema.parse(doc.file)
}

/** Checks a licence in as a POS would and verifies the signed answer with the public key. */
const checkIn = async (file: unknown, licenceId: string) => {
  const result = await callEndpoint(payload, licenceCheck, { body: { licence: file, host } })
  if (result.status !== 200) return { http: result.status, body: result.body }
  const verified = verifyLicenceStatus(result.body.status, {
    publicKeyPem: licenceKeys().publicKeyPem,
    licenceId,
  })
  if (!verified.valid) throw new Error(`Bad status: ${verified.message}`)
  return { http: 200, status: verified.status }
}

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  owner = await payload.create({
    collection: 'users',
    data: { email: `licences-${run}@kiln.test`, password: 'correct-horse-battery-staple' },
    overrideAccess: true,
    context: { [OWNER_SEED_CONTEXT]: true },
  })
  client = await makeClient('Licence Shop')
})

afterAll(async () => {
  const ids = clients.map((c) => c.id)
  // Superseded links point between licences; clear them before deleting.
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
    collection: 'audit-log',
    where: { createdAt: { greater_than_equal: startedAt } },
    overrideAccess: true,
  })
  for (const id of ids) await payload.delete({ collection: 'clients', id, overrideAccess: true })
  await payload.delete({ collection: 'users', id: owner.id, overrideAccess: true })
})

describe('issuing (BR-30, BR-31)', () => {
  it('needs a signed-in owner and an active client', async () => {
    expect(
      await callEndpoint(payload, issueLicence, {
        params: { id: client.id },
        body: { term: '12m', allowedHosts: [host], modules: [], maxRegisters: 1 },
      }),
    ).toMatchObject({ status: 401 })
    const archived = await makeClient('Closed Licence Shop', 'archived')
    expect(await issue(archived)).toMatchObject({
      status: 409,
      body: { error: { code: 'client_archived' } },
    })
  })

  it('rejects bad hosts and register counts', async () => {
    expect(await issue(client, { allowedHosts: ['https://pos.example.com'] })).toMatchObject({
      status: 400,
    })
    expect(await issue(client, { allowedHosts: [] })).toMatchObject({ status: 400 })
    expect(await issue(client, { maxRegisters: 0 })).toMatchObject({ status: 400 })
  })

  it('signs a licence the POS accepts, for the chosen term', async () => {
    const result = await issue(client, { term: 'trial', allowedHosts: [host, host.toUpperCase()] })
    expect(result).toMatchObject({
      status: 201,
      body: { licenceId: expect.stringMatching(/^lic_/) },
    })
    const verified = verifyLicence(await fileOf(result.body.id), {
      publicKeyPem: licenceKeys().publicKeyPem,
      publicUrl: `https://${host}`,
    })
    expect(verified).toMatchObject({
      valid: true,
      licence: {
        clientId: client.clientId,
        allowedHosts: [host],
        modules: ['inventory'],
        maxRegisters: 2,
      },
    })
    if (!verified.valid) return
    const days =
      (Date.parse(verified.licence.expiresAt) - Date.parse(verified.licence.issuedAt)) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(28)
    expect(days).toBeLessThanOrEqual(31)
  })

  it('downloads licence.json and audits it', async () => {
    const { docs } = await payload.find({
      collection: 'licences',
      where: { client: { equals: client.id } },
      limit: 1,
      overrideAccess: true,
    })
    const req = await createLocalReq({ user: { ...owner, collection: 'users' } }, payload)
    req.routeParams = { id: docs[0]!.id }
    const response = await downloadLicence.handler(req)
    expect(response.headers.get('content-disposition')).toContain(
      `licence-${docs[0]!.licenceId}.json`,
    )
    expect(licenceFileSchema.parse(JSON.parse(await response.text()))).toEqual(docs[0]!.file)
  })
})

describe('check-in, renewal and revocation (BR-32)', () => {
  let first: { id: number; licenceId: string; file: LicenceFile }
  let second: { id: number; licenceId: string; file: LicenceFile }

  it('answers active for the current licence and records the check-in', async () => {
    const result = await issue(client)
    first = { ...result.body, file: await fileOf(result.body.id) }
    expect(await checkIn(first.file, first.licenceId)).toMatchObject({
      http: 200,
      status: { status: 'active', licenceId: first.licenceId },
    })
    const stored = await payload.findByID({
      collection: 'licences',
      id: first.id,
      overrideAccess: true,
    })
    expect(stored.lastCheckInHost).toBe(host)
    expect(stored.lastCheckInAt).toBeTruthy()
  })

  it('hands the renewal to a POS still on the old licence', async () => {
    const result = await issue(client, { maxRegisters: 5 })
    second = { ...result.body, file: await fileOf(result.body.id) }
    const answer = await checkIn(first.file, first.licenceId)
    expect(answer).toMatchObject({ http: 200, status: { status: 'superseded' } })
    expect(answer.status?.licence).toEqual(second.file)
    expect(await checkIn(second.file, second.licenceId)).toMatchObject({
      status: { status: 'active' },
    })
  })

  it('stops the renewed licence and everything it superseded once revoked', async () => {
    const revoked = await callEndpoint(payload, revokeLicence, {
      user: owner,
      params: { id: second.id },
      body: { reason: 'Unpaid invoice' },
    })
    expect(revoked).toMatchObject({ status: 200, body: { licenceId: second.licenceId } })
    expect(await checkIn(second.file, second.licenceId)).toMatchObject({
      status: { status: 'revoked' },
    })
    // Revoking the renewal must not bring the older licence back to life.
    expect(await checkIn(first.file, first.licenceId)).toMatchObject({
      status: { status: 'revoked' },
    })
    expect(
      await callEndpoint(payload, revokeLicence, {
        user: owner,
        params: { id: second.id },
        body: { reason: 'Again' },
      }),
    ).toMatchObject({ status: 409 })
  })

  it('hands a new licence to a POS stopped by a revocation', async () => {
    const result = await issue(client)
    const file = await fileOf(result.body.id)
    expect(await checkIn(file, result.body.licenceId)).toMatchObject({
      status: { status: 'active' },
    })
    for (const old of [second, first]) {
      const answer = await checkIn(old.file, old.licenceId)
      expect(answer).toMatchObject({ status: { status: 'superseded' } })
      expect(answer.status?.licence).toEqual(file)
    }
  })

  it('rejects licences this builder did not sign or does not know', async () => {
    const foreign = signLicence(
      {
        version: 1,
        licenceId: 'lic_foreign',
        clientId: client.clientId!,
        allowedHosts: [host],
        modules: [],
        maxRegisters: 1,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      generateLicenceKeyPair().privateKeyPem,
    )
    expect(await checkIn(foreign, 'lic_foreign')).toMatchObject({ http: 400 })
    const unknown = signLicence(
      {
        ...JSON.parse(Buffer.from(foreign.payload, 'base64url').toString()),
        licenceId: 'lic_unknown',
      },
      licenceKeys().privateKeyPem,
    )
    expect(await checkIn(unknown, 'lic_unknown')).toMatchObject({ http: 404 })
    expect(await checkIn('garbage', 'x')).toMatchObject({ http: 400 })
  })

  it('audits issuing and revoking', async () => {
    const audit = await payload.find({
      collection: 'audit-log',
      where: {
        and: [
          { entityId: { equals: String(client.id) } },
          { action: { in: ['issue_licence', 'revoke_licence', 'download_licence'] } },
        ],
      },
      pagination: false,
      overrideAccess: true,
    })
    const actions = audit.docs.map((entry) => entry.action)
    expect(actions.filter((a) => a === 'issue_licence')).toHaveLength(4)
    expect(actions).toContain('revoke_licence')
    expect(actions).toContain('download_licence')
  })
})
