import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

/** 4–6 digits (FR-12). */
export const PIN_PATTERN = /^\d{4,6}$/
const KEY_LENGTH = 32

/** `scrypt$<salt>$<hash>`, both base64url. PINs are never stored in plain text. */
export async function hashPin(pin: string): Promise<string> {
  if (!PIN_PATTERN.test(pin)) throw new Error('A PIN is 4 to 6 digits')
  const salt = randomBytes(16)
  const hash = await scryptAsync(pin, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPinHash(
  pin: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored || !PIN_PATTERN.test(pin)) return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await scryptAsync(pin, Buffer.from(salt, 'base64url'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const PIN_MAX_FAILURES = 5
export const PIN_LOCK_MS = 5 * 60 * 1000

interface Attempts {
  failures: number
  lockedUntil: number
}

/** Failed PIN attempts per user, process-wide (one POS server per client). */
const store = globalThis as typeof globalThis & { __kilnPinAttempts?: Map<number, Attempts> }
const attempts = (store.__kilnPinAttempts ??= new Map())

/** Milliseconds until `userId` may try a PIN again, or 0. */
export function pinLockRemaining(userId: number, now = Date.now()): number {
  return Math.max(0, (attempts.get(userId)?.lockedUntil ?? 0) - now)
}

/** Records a PIN attempt; five failures lock the user's PIN for five minutes. */
export function recordPinAttempt(userId: number, success: boolean, now = Date.now()): void {
  if (success) {
    attempts.delete(userId)
    return
  }
  const entry = attempts.get(userId) ?? { failures: 0, lockedUntil: 0 }
  entry.failures += 1
  if (entry.failures >= PIN_MAX_FAILURES) {
    entry.failures = 0
    entry.lockedUntil = now + PIN_LOCK_MS
  }
  attempts.set(userId, entry)
}

/** Clears all attempt counters. Exported for tests. */
export function resetPinAttempts(): void {
  attempts.clear()
}

export const ACTING_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
export const ACTING_HEADER = 'x-kiln-acting-user'

interface ActingClaims {
  /** Staff member now working the till. */
  userId: number
  /** User whose full login started the device session; the token is valid only with it. */
  deviceUserId: number
  expiresAt: number
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`kiln-acting:${body}`).digest('base64url')
}

/** A signed token naming the staff member working a till after a PIN switch (FR-12). */
export function signActingToken(
  secret: string,
  claims: Omit<ActingClaims, 'expiresAt'>,
  now = Date.now(),
) {
  const body = Buffer.from(
    JSON.stringify({ ...claims, expiresAt: now + ACTING_TOKEN_TTL_MS }),
  ).toString('base64url')
  return `${body}.${sign(secret, body)}`
}

/** The claims of a valid, unexpired token, or null. */
export function verifyActingToken(
  secret: string,
  token: string,
  now = Date.now(),
): ActingClaims | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  const expected = Buffer.from(sign(secret, body))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ActingClaims
    if (!Number.isInteger(claims.userId) || !Number.isInteger(claims.deviceUserId)) return null
    return claims.expiresAt > now ? claims : null
  } catch {
    return null
  }
}
