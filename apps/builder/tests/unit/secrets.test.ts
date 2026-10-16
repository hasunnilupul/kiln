import { describe, expect, it } from 'vitest'

import { seal, signToken, unseal, verifyToken } from '@/lib/secrets'

const secret = 'a'.repeat(32)
const other = 'b'.repeat(32)

describe('seal / unseal', () => {
  it('round-trips and produces a different ciphertext each time', () => {
    const a = seal('JBSWY3DPEHPK3PXP', secret, 'totp-secret')
    const b = seal('JBSWY3DPEHPK3PXP', secret, 'totp-secret')
    expect(a).not.toBe(b)
    expect(unseal(a, secret, 'totp-secret')).toBe('JBSWY3DPEHPK3PXP')
  })

  it('refuses another key, another purpose or a tampered value', () => {
    const sealed = seal('value', secret, 'totp-secret')
    expect(() => unseal(sealed, other, 'totp-secret')).toThrow()
    expect(() => unseal(sealed, secret, 'other-purpose')).toThrow()
    const parts = sealed.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => unseal(parts.join('.'), secret, 'totp-secret')).toThrow()
    expect(() => unseal('not sealed', secret, 'totp-secret')).toThrow('Not a sealed value')
  })

  it('needs a PAYLOAD_SECRET of at least 32 characters', () => {
    expect(() => seal('value', 'short', 'totp-secret')).toThrow('PAYLOAD_SECRET')
  })
})

describe('signToken / verifyToken', () => {
  const now = Date.UTC(2026, 9, 16, 12, 0, 0)

  it('returns the claims until the token expires', () => {
    const token = signToken({ userId: 7 }, secret, 'totp-enrol', 600, now)
    expect(verifyToken(token, secret, 'totp-enrol', now + 599_000)).toMatchObject({ userId: 7 })
    expect(verifyToken(token, secret, 'totp-enrol', now + 600_000)).toBeNull()
  })

  it('refuses another key, another purpose or edited claims', () => {
    const token = signToken({ userId: 7 }, secret, 'totp-enrol', 600, now)
    expect(verifyToken(token, other, 'totp-enrol', now)).toBeNull()
    expect(verifyToken(token, secret, 'build-callback', now)).toBeNull()
    const [, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ userId: 1, exp: now / 1000 + 600 })).toString(
      'base64url',
    )
    expect(verifyToken(`${forged}.${mac}`, secret, 'totp-enrol', now)).toBeNull()
    expect(verifyToken('garbage', secret, 'totp-enrol', now)).toBeNull()
  })
})
