import { afterEach, describe, expect, it } from 'vitest'

import {
  ACTING_TOKEN_TTL_MS,
  PIN_LOCK_MS,
  hashPin,
  pinLockRemaining,
  recordPinAttempt,
  resetPinAttempts,
  signActingToken,
  verifyActingToken,
  verifyPinHash,
} from '@/lib/pin'

afterEach(() => resetPinAttempts())

describe('PIN hashing (FR-12)', () => {
  it('verifies the right PIN only, with a fresh salt each time', async () => {
    const a = await hashPin('1234')
    const b = await hashPin('1234')
    expect(a).not.toBe(b)
    expect(a).not.toContain('1234')
    expect(await verifyPinHash('1234', a)).toBe(true)
    expect(await verifyPinHash('1235', a)).toBe(false)
  })

  it.each(['123', '1234567', '12a4', ''])('refuses to hash %j', async (pin) => {
    await expect(hashPin(pin)).rejects.toThrow()
  })

  it.each([null, '', 'plain', 'bcrypt$x$y', 'scrypt$$'])(
    'rejects stored value %j',
    async (stored) => {
      expect(await verifyPinHash('1234', stored)).toBe(false)
    },
  )
})

describe('PIN attempt limit', () => {
  it('locks after five failures and unlocks after the lock time', () => {
    const now = 1_000_000
    for (let i = 0; i < 4; i += 1) recordPinAttempt(7, false, now)
    expect(pinLockRemaining(7, now)).toBe(0)
    recordPinAttempt(7, false, now)
    expect(pinLockRemaining(7, now)).toBe(PIN_LOCK_MS)
    expect(pinLockRemaining(7, now + PIN_LOCK_MS)).toBe(0)
  })

  it('resets on success', () => {
    for (let i = 0; i < 4; i += 1) recordPinAttempt(8, false)
    recordPinAttempt(8, true)
    recordPinAttempt(8, false)
    expect(pinLockRemaining(8)).toBe(0)
  })
})

describe('acting-user tokens', () => {
  const secret = 'test-secret'

  it('round-trips claims until expiry', () => {
    const now = 5_000
    const token = signActingToken(secret, { userId: 2, deviceUserId: 1 }, now)
    expect(verifyActingToken(secret, token, now + 1)).toEqual({
      userId: 2,
      deviceUserId: 1,
      expiresAt: now + ACTING_TOKEN_TTL_MS,
    })
    expect(verifyActingToken(secret, token, now + ACTING_TOKEN_TTL_MS)).toBeNull()
  })

  it('rejects tampered tokens and other secrets', () => {
    const token = signActingToken(secret, { userId: 2, deviceUserId: 1 })
    const [, signature] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ userId: 3, deviceUserId: 1, expiresAt: Date.now() + 1e6 })).toString('base64url')}.${signature}`
    expect(verifyActingToken(secret, forged)).toBeNull()
    expect(verifyActingToken('other-secret', token)).toBeNull()
    expect(verifyActingToken(secret, 'garbage')).toBeNull()
  })
})
