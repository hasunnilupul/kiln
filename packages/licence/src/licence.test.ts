import { generateKeyPairSync, sign } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'

import { effectiveModules, licencePayloadSchema, type LicencePayload } from './licence.js'
import {
  generateLicenceKeyPair,
  serializeLicence,
  signLicence,
  type LicenceKeyPair,
} from './sign.js'
import { CLOCK_SKEW_MS, verifyLicence } from './verify.js'

const payload: LicencePayload = {
  version: 1,
  licenceId: 'lic_01',
  clientId: 'cl_01',
  allowedHosts: ['pos.acmemart.example', 'localhost'],
  modules: ['inventory', 'discounts'],
  maxRegisters: 2,
  issuedAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2027-10-01T00:00:00.000Z',
}

const duringTerm = new Date('2027-01-15T12:00:00Z')

let keys: LicenceKeyPair
let otherKeys: LicenceKeyPair

beforeAll(() => {
  keys = generateLicenceKeyPair()
  otherKeys = generateLicenceKeyPair()
})

function check(
  file: unknown,
  overrides: { publicUrl?: string; now?: Date; publicKeyPem?: string } = {},
) {
  return verifyLicence(file, {
    publicKeyPem: keys.publicKeyPem,
    publicUrl: 'https://pos.acmemart.example',
    now: duringTerm,
    ...overrides,
  })
}

/** Signs arbitrary payload text, bypassing payload validation. */
function signRaw(text: string) {
  const bytes = Buffer.from(text, 'utf8')
  return {
    alg: 'Ed25519',
    payload: bytes.toString('base64url'),
    signature: sign(null, bytes, keys.privateKeyPem).toString('base64url'),
  }
}

describe('licencePayloadSchema (BR-30)', () => {
  it('accepts a valid payload', () => {
    expect(licencePayloadSchema.safeParse(payload).success).toBe(true)
  })

  it.each<[string, Partial<LicencePayload> | Record<string, unknown>]>([
    ['an expiry before issue', { expiresAt: '2026-09-01T00:00:00.000Z' }],
    ['repeated modules', { modules: ['inventory', 'inventory'] }],
    ['unknown modules', { modules: ['loyalty'] }],
    ['a host with a scheme', { allowedHosts: ['https://pos.example'] }],
    ['a host with a port', { allowedHosts: ['pos.example:3000'] }],
    ['an upper-case host', { allowedHosts: ['POS.example'] }],
    ['no hosts', { allowedHosts: [] }],
    ['zero registers', { maxRegisters: 0 }],
    ['a non-ISO date', { issuedAt: 'yesterday' }],
    ['an unknown version', { version: 2 }],
    ['extra fields', { secret: 'x' }],
  ])('rejects %s', (_name, override) => {
    expect(licencePayloadSchema.safeParse({ ...payload, ...override }).success).toBe(false)
  })
})

describe('signLicence and verifyLicence (BR-31, FR-04)', () => {
  it('round-trips a signed licence from licence.json text', () => {
    const text = serializeLicence(signLicence(payload, keys.privateKeyPem))
    expect(text.endsWith('\n')).toBe(true)
    expect(check(text)).toEqual({ valid: true, licence: payload })
  })

  it('accepts an already-parsed file', () => {
    expect(check(signLicence(payload, keys.privateKeyPem)).valid).toBe(true)
  })

  it('defaults to the current time', () => {
    const current = {
      ...payload,
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const result = verifyLicence(signLicence(current, keys.privateKeyPem), {
      publicKeyPem: keys.publicKeyPem,
      publicUrl: 'http://localhost:3000',
    })
    expect(result.valid).toBe(true)
  })

  it('matches the host case-insensitively and ignores the port', () => {
    const file = signLicence(payload, keys.privateKeyPem)
    expect(check(file, { publicUrl: 'https://POS.AcmeMart.example:8443/pos' }).valid).toBe(true)
  })

  it('rejects an unlisted host', () => {
    const file = signLicence(payload, keys.privateKeyPem)
    expect(check(file, { publicUrl: 'https://copy.example' })).toMatchObject({
      valid: false,
      reason: 'host_not_allowed',
    })
  })

  it('rejects an invalid PUBLIC_URL', () => {
    const file = signLicence(payload, keys.privateKeyPem)
    expect(check(file, { publicUrl: 'pos.acmemart.example' })).toMatchObject({
      valid: false,
      reason: 'host_not_allowed',
    })
  })

  it('rejects an expired licence at the exact expiry time', () => {
    const file = signLicence(payload, keys.privateKeyPem)
    expect(check(file, { now: new Date(payload.expiresAt) })).toMatchObject({
      valid: false,
      reason: 'expired',
    })
  })

  it('allows small clock skew before issuedAt but no more', () => {
    const file = signLicence(payload, keys.privateKeyPem)
    const issued = Date.parse(payload.issuedAt)
    expect(check(file, { now: new Date(issued - CLOCK_SKEW_MS) }).valid).toBe(true)
    expect(check(file, { now: new Date(issued - CLOCK_SKEW_MS - 1) })).toMatchObject({
      valid: false,
      reason: 'not_yet_valid',
    })
  })

  it('rejects a tampered payload', () => {
    const file = signLicence(payload, keys.privateKeyPem)
    const tampered = Buffer.from(JSON.stringify({ ...payload, maxRegisters: 50 })).toString(
      'base64url',
    )
    expect(check({ ...file, payload: tampered })).toMatchObject({
      valid: false,
      reason: 'bad_signature',
    })
  })

  it('rejects a licence signed with another key', () => {
    const file = signLicence(payload, otherKeys.privateKeyPem)
    expect(check(file)).toMatchObject({ valid: false, reason: 'bad_signature' })
  })

  it.each<[string, unknown]>([
    ['invalid JSON', '{ nope'],
    ['a missing signature', { alg: 'Ed25519', payload: 'abc' }],
    ['another algorithm', { alg: 'RS256', payload: 'abc', signature: 'abc' }],
    ['a non-object', 42],
  ])('reports %s as malformed', (_name, file) => {
    expect(check(file)).toMatchObject({ valid: false, reason: 'malformed' })
  })

  it('reports a signed payload that is not JSON as malformed', () => {
    expect(check(signRaw('not json'))).toMatchObject({ valid: false, reason: 'malformed' })
  })

  it('reports a signed payload with the wrong shape as malformed', () => {
    expect(check(signRaw(JSON.stringify({ version: 1 })))).toMatchObject({
      valid: false,
      reason: 'malformed',
    })
  })

  it('refuses to sign an invalid payload', () => {
    expect(() => signLicence({ ...payload, maxRegisters: 0 }, keys.privateKeyPem)).toThrow()
  })

  it('refuses keys that are not Ed25519', () => {
    const ec = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    expect(() => signLicence(payload, ec.privateKey)).toThrow(/Ed25519/)
    expect(() =>
      check(signLicence(payload, keys.privateKeyPem), { publicKeyPem: ec.publicKey }),
    ).toThrow(/Ed25519/)
  })
})

describe('effectiveModules', () => {
  it('keeps unlicensed modules off even when enabled in settings', () => {
    expect(
      effectiveModules(
        { inventory: true, customers: true, discounts: false, multiOutlet: true },
        payload,
      ),
    ).toEqual({ inventory: true, customers: false, discounts: false, multiOutlet: false })
  })

  it('turns on every licensed and enabled module', () => {
    const all: LicencePayload = {
      ...payload,
      modules: ['inventory', 'customers', 'discounts', 'multiOutlet'],
    }
    expect(
      effectiveModules(
        { inventory: true, customers: true, discounts: true, multiOutlet: true },
        all,
      ),
    ).toEqual({ inventory: true, customers: true, discounts: true, multiOutlet: true })
  })
})
