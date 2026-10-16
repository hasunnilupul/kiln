import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { LicenceFile, LicencePayload, LicenceStatus } from '@kiln/licence'
import {
  generateLicenceKeyPair,
  serializeLicence,
  signLicence,
  signLicenceStatus,
  type LicenceKeyPair,
} from '@kiln/licence/sign'
import type { Payload } from 'payload'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { checkLicence, setLicenceState } from '@/lib/licence'

/** BR-32: what `checkLicence` writes to disk after a check-in. */

let keys: LicenceKeyPair
let dir: string

const issued = new Date(Date.now() - 24 * 60 * 60 * 1000)
const licence = (licenceId: string): LicencePayload => ({
  version: 1,
  licenceId,
  clientId: 'cl_01',
  allowedHosts: ['pos.acmemart.example'],
  modules: ['inventory'],
  maxRegisters: 2,
  issuedAt: issued.toISOString(),
  expiresAt: new Date(issued.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
})

const stubPayload = {
  findGlobal: async () => ({ clientId: 'cl_01' }),
  logger: { info: () => {}, warn: () => {}, error: () => {} },
} as unknown as Payload

const env = () =>
  ({
    NODE_ENV: 'test',
    LICENCE_PATH: path.join(dir, 'licence.json'),
    LICENCE_PUBLIC_KEY: keys.publicKeyPem,
    LICENCE_SERVER_URL: 'https://builder.example',
    PUBLIC_URL: 'https://pos.acmemart.example',
  }) as unknown as NodeJS.ProcessEnv

/** A fake builder answering every check-in with `answer`, or failing when it is null. */
const builder = (answer: Omit<LicenceStatus, 'type' | 'version' | 'checkedAt'> | null) =>
  (async () => {
    if (!answer) throw new Error('ECONNREFUSED')
    const status = signLicenceStatus(
      { type: 'licence-status', version: 1, checkedAt: new Date().toISOString(), ...answer },
      keys.privateKeyPem,
    )
    return Response.json({ status })
  }) as unknown as typeof fetch

const files = {
  licence: () => readFile(path.join(dir, 'licence.json'), 'utf8'),
  status: () => readFile(path.join(dir, 'licence-status.json'), 'utf8').catch(() => null),
}

beforeAll(() => {
  keys = generateLicenceKeyPair()
})

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kiln-licence-'))
  await writeFile(
    path.join(dir, 'licence.json'),
    serializeLicence(signLicence(licence('lic_old'), keys.privateKeyPem)),
  )
})

afterEach(async () => {
  setLicenceState(undefined)
  await rm(dir, { recursive: true, force: true })
})

describe('checkLicence with a licence server', () => {
  it('stores the signed confirmation', async () => {
    const state = await checkLicence(
      stubPayload,
      env(),
      builder({ licenceId: 'lic_old', status: 'active' }),
    )
    expect(state).toMatchObject({
      status: 'valid',
      checkIn: { lastConfirmedAt: expect.any(String) },
    })
    expect(JSON.parse((await files.status())!)).toMatchObject({ alg: 'Ed25519' })
  })

  it('installs a renewal in place of licence.json', async () => {
    const newer: LicenceFile = signLicence(licence('lic_new'), keys.privateKeyPem)
    const state = await checkLicence(
      stubPayload,
      env(),
      builder({ licenceId: 'lic_old', status: 'superseded', licence: newer }),
    )
    expect(state).toMatchObject({ status: 'valid', licence: { licenceId: 'lic_new' } })
    expect(JSON.parse(await files.licence())).toEqual(newer)
    expect(await files.status()).toBeNull()
  })

  it('locks on revocation, and stays locked offline after a restart', async () => {
    expect(
      await checkLicence(stubPayload, env(), builder({ licenceId: 'lic_old', status: 'revoked' })),
    ).toMatchObject({ status: 'invalid', reason: 'revoked' })
    expect(await checkLicence(stubPayload, env(), builder(null))).toMatchObject({
      status: 'invalid',
      reason: 'revoked',
    })
  })

  it('keeps working within the grace period when the builder is down', async () => {
    expect(await checkLicence(stubPayload, env(), builder(null))).toMatchObject({
      status: 'valid',
      checkIn: { failing: expect.stringContaining('ECONNREFUSED'), lockAt: expect.any(String) },
    })
  })
})
