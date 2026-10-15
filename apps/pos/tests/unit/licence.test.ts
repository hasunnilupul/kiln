import type { LicencePayload } from '@kiln/licence'
import { generateLicenceKeyPair, serializeLicence, signLicence } from '@kiln/licence/sign'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  evaluateLicence,
  isLicenceUsable,
  licenceSources,
  licensedModules,
  setLicenceState,
  type LicenceInputs,
} from '@/lib/licence'

const payload: LicencePayload = {
  version: 1,
  licenceId: 'lic_test',
  clientId: 'cl_01',
  allowedHosts: ['pos.acmemart.example'],
  modules: ['inventory', 'discounts'],
  maxRegisters: 2,
  issuedAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2027-10-01T00:00:00.000Z',
}
const now = new Date('2027-01-01T00:00:00Z')

let base: LicenceInputs

beforeAll(() => {
  const keys = generateLicenceKeyPair()
  base = {
    fileText: serializeLicence(signLicence(payload, keys.privateKeyPem)),
    publicKeyPem: keys.publicKeyPem,
    publicUrl: 'https://pos.acmemart.example',
    production: true,
    clientId: 'cl_01',
    now,
  }
})

afterEach(() => setLicenceState(undefined))

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv

describe('evaluateLicence (FR-04)', () => {
  it('accepts a valid licence for this client and host', () => {
    expect(evaluateLicence(base)).toMatchObject({
      status: 'valid',
      licence: { licenceId: 'lic_test' },
    })
  })

  it('accepts a licence before the database is seeded', () => {
    expect(evaluateLicence({ ...base, clientId: null }).status).toBe('valid')
  })

  it.each<[string, Partial<LicenceInputs>, string]>([
    ['no licence file in production', { fileText: null }, 'missing'],
    ['no embedded public key', { publicKeyPem: '' }, 'no_public_key'],
    ['an unusable public key', { publicKeyPem: 'not a key' }, 'no_public_key'],
    ['an expired licence', { now: new Date('2027-10-01T00:00:00Z') }, 'expired'],
    ['another host', { publicUrl: 'https://copy.example' }, 'host_not_allowed'],
    ['no PUBLIC_URL in production', { publicUrl: '' }, 'host_not_allowed'],
    ['another client', { clientId: 'cl_99' }, 'client_mismatch'],
    [
      'a tampered file',
      { fileText: '{"alg":"Ed25519","payload":"e30","signature":"AAAA"}' },
      'bad_signature',
    ],
  ])('rejects %s', (_name, override, reason) => {
    expect(evaluateLicence({ ...base, ...override })).toMatchObject({ status: 'invalid', reason })
  })

  it('runs unlicensed without a file in development', () => {
    expect(evaluateLicence({ ...base, fileText: null, production: false }).status).toBe(
      'unlicensed-development',
    )
  })
})

describe('licenceSources', () => {
  it('uses only the embedded key in production', () => {
    const sources = licenceSources(env({ NODE_ENV: 'production', LICENCE_PUBLIC_KEY: 'from-env' }))
    expect(sources.publicKeyPem).toBe('')
    expect(sources.publicUrl).toBe('')
  })

  it('accepts a key from the environment outside production', () => {
    const sources = licenceSources(env({ LICENCE_PUBLIC_KEY: 'line1\\nline2', PORT: '4000' }))
    expect(sources.publicKeyPem).toBe('line1\nline2')
    expect(sources.publicUrl).toBe('http://localhost:4000')
  })
})

describe('module gating', () => {
  const allOn = { inventory: true, customers: true, discounts: true, multiOutlet: true }

  it('turns off modules the licence does not grant', () => {
    setLicenceState(evaluateLicence(base))
    expect(licensedModules(allOn)).toEqual({
      inventory: true,
      customers: false,
      discounts: true,
      multiOutlet: false,
    })
  })

  it('turns everything off while the licence is invalid', () => {
    setLicenceState(evaluateLicence({ ...base, fileText: null }))
    expect(licensedModules(allOn)).toEqual({
      inventory: false,
      customers: false,
      discounts: false,
      multiOutlet: false,
    })
    expect(isLicenceUsable()).toBe(false)
  })

  it('keeps the settings in unlicensed development', () => {
    setLicenceState(evaluateLicence({ ...base, fileText: null, production: false }))
    expect(licensedModules(allOn)).toEqual(allOn)
    expect(isLicenceUsable()).toBe(true)
  })

  it('treats an unchecked licence as unusable only in production', () => {
    expect(isLicenceUsable(env({ NODE_ENV: 'production' }))).toBe(false)
    expect(isLicenceUsable(env({ NODE_ENV: 'test' }))).toBe(true)
  })
})
