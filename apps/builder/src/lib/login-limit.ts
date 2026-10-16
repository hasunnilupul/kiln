/**
 * Sign-in rate limit (BR-02): at most 5 failed attempts per 15 minutes per IP address and per
 * account. Payload's own `maxLoginAttempts` additionally locks the account itself.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const MAX_FAILED_LOGINS = 5

/**
 * Payload's own lock: this many wrong passwords in a row, across rate-limit windows, lock the
 * account for an hour. A successful sign-in resets the count; another owner can unlock earlier.
 */
export const MAX_PASSWORD_FAILURES = 10
export const PASSWORD_LOCK_MS = 60 * 60 * 1000

/** Failed attempts this old are no longer needed and may be deleted. */
export const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000

export function loginWindowStart(now: number = Date.now()): Date {
  return new Date(now - LOGIN_WINDOW_MS)
}

/** True when another attempt from this IP or for this account must be refused. */
export function isLoginLimited(failures: { byIp: number; byAccount: number }): boolean {
  return failures.byIp >= MAX_FAILED_LOGINS || failures.byAccount >= MAX_FAILED_LOGINS
}
