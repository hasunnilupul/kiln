import { sign } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'

import type { LicencePayload, LicenceStatus } from './licence.js'
import {
  generateLicenceKeyPair,
  publicKeyFromPrivate,
  signLicence,
  signLicenceStatus,
  type LicenceKeyPair,
} from './sign.js'
import {
  STATUS_MAX_AGE_MS,
  readSignedLicence,
  verifyLicence,
  verifyLicenceStatus,
} from './verify.js'

/** BR-32: the builder's signed answer to a POS licence check-in. */

const now = new Date('2027-01-15T12:00:00Z')

const licence: LicencePayload = {
  version: 1,
  licenceId: 'lic_new',
  clientId: 'cl_01',
  allowedHosts: ['pos.acmemart.example'],
  modules: ['inventory'],
  maxRegisters: 2,
  issuedAt: '2027-01-15T00:00:00.000Z',
  expiresAt: '2028-01-15T00:00:00.000Z',
}

const active: LicenceStatus = {
  type: 'licence-status',
  version: 1,
  licenceId: 'lic_01',
  status: 'active',
  checkedAt: now.toISOString(),
}

let keys: LicenceKeyPair
let other: LicenceKeyPair

beforeAll(() => {
  keys = generateLicenceKeyPair()
  other = generateLicenceKeyPair()
})

const check = (file: unknown, overrides: { licenceId?: string; now?: Date } = {}) =>
  verifyLicenceStatus(file, {
    publicKeyPem: keys.publicKeyPem,
    licenceId: 'lic_01',
    now,
    ...overrides,
  })

describe('signLicenceStatus / verifyLicenceStatus', () => {
  it('round-trips an active status, as an object or as JSON text', () => {
    const file = signLicenceStatus(active, keys.privateKeyPem)
    expect(check(file)).toEqual({ valid: true, status: active })
    expect(check(JSON.stringify(file))).toMatchObject({ valid: true })
  })

  it('carries a newer licence when superseded, which verifies as a licence', () => {
    const newer = signLicence(licence, keys.privateKeyPem)
    const file = signLicenceStatus(
      { ...active, status: 'superseded', licence: newer },
      keys.privateKeyPem,
    )
    const result = check(file)
    expect(result).toMatchObject({ valid: true, status: { status: 'superseded' } })
    if (!result.valid) throw new Error('expected valid')
    expect(
      verifyLicence(result.status.licence, {
        publicKeyPem: keys.publicKeyPem,
        publicUrl: 'https://pos.acmemart.example',
        now,
      }),
    ).toMatchObject({ valid: true, licence: { licenceId: 'lic_new' } })
  })

  it('uses the current time when none is given', () => {
    const fresh = signLicenceStatus(
      { ...active, checkedAt: new Date().toISOString() },
      keys.privateKeyPem,
    )
    expect(
      verifyLicenceStatus(fresh, { publicKeyPem: keys.publicKeyPem, licenceId: 'lic_01' }),
    ).toMatchObject({ valid: true })
  })

  it('refuses to sign a superseded status without the newer licence', () => {
    expect(() =>
      signLicenceStatus({ ...active, status: 'superseded' }, keys.privateKeyPem),
    ).toThrow()
  })

  it('rejects another key, another licence and stale or future answers', () => {
    expect(check(signLicenceStatus(active, other.privateKeyPem))).toMatchObject({
      valid: false,
      reason: 'bad_signature',
    })
    expect(
      check(signLicenceStatus(active, keys.privateKeyPem), { licenceId: 'lic_02' }),
    ).toMatchObject({
      valid: false,
      reason: 'wrong_licence',
    })
    const later = new Date(now.getTime() + STATUS_MAX_AGE_MS + 1)
    expect(check(signLicenceStatus(active, keys.privateKeyPem), { now: later })).toMatchObject({
      valid: false,
      reason: 'stale',
    })
    const earlier = new Date(now.getTime() - STATUS_MAX_AGE_MS - 1)
    expect(check(signLicenceStatus(active, keys.privateKeyPem), { now: earlier })).toMatchObject({
      valid: false,
      reason: 'stale',
    })
  })

  it('never accepts a licence as a status, or a status as a licence', () => {
    expect(check(signLicence(licence, keys.privateKeyPem))).toMatchObject({
      valid: false,
      reason: 'malformed',
    })
    expect(
      verifyLicence(signLicenceStatus(active, keys.privateKeyPem), {
        publicKeyPem: keys.publicKeyPem,
        publicUrl: 'https://pos.acmemart.example',
        now,
      }),
    ).toMatchObject({ valid: false, reason: 'malformed' })
  })

  it('reports malformed envelopes and payloads', () => {
    expect(check('not json')).toMatchObject({ valid: false, reason: 'malformed' })
    expect(check({ alg: 'RS256' })).toMatchObject({ valid: false, reason: 'malformed' })
    const bytes = Buffer.from('not json', 'utf8')
    expect(
      check({
        alg: 'Ed25519',
        payload: bytes.toString('base64url'),
        signature: sign(null, bytes, keys.privateKeyPem).toString('base64url'),
      }),
    ).toMatchObject({ valid: false, reason: 'malformed' })
  })
})

describe('verifyLicenceStatus maxAgeMs', () => {
  it('accepts an older stored answer within the allowed age', () => {
    const file = signLicenceStatus(active, keys.privateKeyPem)
    const sixDaysLater = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000)
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    expect(check(file, { now: sixDaysLater })).toMatchObject({ valid: false, reason: 'stale' })
    expect(
      verifyLicenceStatus(file, {
        publicKeyPem: keys.publicKeyPem,
        licenceId: 'lic_01',
        now: sixDaysLater,
        maxAgeMs: sevenDays,
      }),
    ).toMatchObject({ valid: true })
  })
})

describe('readSignedLicence', () => {
  it('returns the payload of a correctly signed licence, even an expired one', () => {
    const expired = signLicence(
      { ...licence, issuedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2021-01-01T00:00:00.000Z' },
      keys.privateKeyPem,
    )
    expect(readSignedLicence(expired, keys.publicKeyPem)).toMatchObject({
      valid: true,
      licence: { licenceId: 'lic_new' },
    })
  })

  it('rejects other keys and non-licence payloads', () => {
    expect(
      readSignedLicence(signLicence(licence, other.privateKeyPem), keys.publicKeyPem),
    ).toMatchObject({
      valid: false,
    })
    expect(
      readSignedLicence(signLicenceStatus(active, keys.privateKeyPem), keys.publicKeyPem),
    ).toMatchObject({ valid: false, message: 'Licence payload does not have the expected shape' })
  })
})

describe('publicKeyFromPrivate', () => {
  it('derives the public key that verifies the signing key’s licences', () => {
    expect(publicKeyFromPrivate(keys.privateKeyPem)).toBe(keys.publicKeyPem)
  })
})
