import { describe, expect, it } from 'vitest'

import { generateTotpSecret, totpCode, totpStep, totpUri, verifyTotp } from '@/lib/totp'

/** TOTP for owner sign-in (BR-01). */

const secret = generateTotpSecret()
const now = Date.UTC(2026, 9, 16, 12, 0, 15)

describe('verifyTotp', () => {
  it('accepts the current code and returns its time step', () => {
    expect(verifyTotp(secret, totpCode(secret, now), { timestamp: now })).toBe(totpStep(now))
  })

  it('tolerates one step of clock drift either way, but not two', () => {
    const previous = totpCode(secret, now - 30_000)
    const next = totpCode(secret, now + 30_000)
    expect(verifyTotp(secret, previous, { timestamp: now })).toBe(totpStep(now) - 1)
    expect(verifyTotp(secret, next, { timestamp: now })).toBe(totpStep(now) + 1)
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), { timestamp: now })).toBeNull()
  })

  it('rejects a code already used, or one older than the last used', () => {
    const code = totpCode(secret, now)
    expect(verifyTotp(secret, code, { timestamp: now, lastUsedStep: totpStep(now) })).toBeNull()
    expect(
      verifyTotp(secret, totpCode(secret, now - 30_000), {
        timestamp: now,
        lastUsedStep: totpStep(now),
      }),
    ).toBeNull()
  })

  it('ignores spaces and rejects anything but six digits', () => {
    const code = totpCode(secret, now)
    expect(
      verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { timestamp: now }),
    ).not.toBeNull()
    expect(verifyTotp(secret, '', { timestamp: now })).toBeNull()
    expect(verifyTotp(secret, '12345a', { timestamp: now })).toBeNull()
    expect(verifyTotp(secret, `${code}0`, { timestamp: now })).toBeNull()
  })

  it('rejects codes for another secret', () => {
    expect(verifyTotp(generateTotpSecret(), totpCode(secret, now), { timestamp: now })).toBeNull()
  })
})

describe('totpUri', () => {
  it('names the issuer and account for the authenticator app', () => {
    const uri = totpUri(secret, 'owner@kiln.test')
    expect(uri).toMatch(/^otpauth:\/\/totp\/Kiln%20Builder:owner%40kiln\.test\?/)
    expect(uri).toContain(`secret=${secret}`)
  })
})
