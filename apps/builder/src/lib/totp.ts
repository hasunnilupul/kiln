import { Secret, TOTP } from 'otpauth'

/** RFC 6238 defaults, which every authenticator app supports. */
const PERIOD_SECONDS = 30
const DIGITS = 6
/** Accept the previous and next code too, for clock drift between phone and server. */
const WINDOW = 1

export const TOTP_ISSUER = 'Kiln Builder'

/** A new random base32 secret (160 bits, as RFC 4226 recommends). */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

/** `otpauth://` URI for the authenticator app's QR code. */
export function totpUri(secret: string, accountName: string): string {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label: accountName,
    secret: Secret.fromBase32(secret),
    digits: DIGITS,
    period: PERIOD_SECONDS,
  }).toString()
}

/** The time step (30-second counter) at `timestamp`. */
export function totpStep(timestamp: number = Date.now()): number {
  return Math.floor(timestamp / 1000 / PERIOD_SECONDS)
}

/** The code an authenticator shows at `timestamp`; used by tests and development tools. */
export function totpCode(secret: string, timestamp: number = Date.now()): string {
  return TOTP.generate({
    secret: Secret.fromBase32(secret),
    digits: DIGITS,
    period: PERIOD_SECONDS,
    timestamp,
  })
}

/**
 * Checks a six-digit code and returns the time step it belongs to, or null when it is wrong.
 * A code at or before `lastUsedStep` is rejected so an intercepted code cannot be replayed (BR-01).
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { lastUsedStep?: number | null; timestamp?: number } = {},
): number | null {
  const token = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(token)) return null
  const timestamp = options.timestamp ?? Date.now()
  const delta = TOTP.validate({
    token,
    secret: Secret.fromBase32(secret),
    digits: DIGITS,
    period: PERIOD_SECONDS,
    timestamp,
    window: WINDOW,
  })
  if (delta === null) return null
  const step = totpStep(timestamp) + delta
  if (options.lastUsedStep != null && step <= options.lastUsedStep) return null
  return step
}
