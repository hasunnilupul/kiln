import type { LicencePayload } from '@kiln/licence'
import { verifyLicenceStatus } from '@kiln/licence/verify'

/**
 * Online licence check-in (BR-32). Once a day the POS sends its `licence.json` to the builder,
 * which answers with a signed status: active, revoked, or superseded by a newer licence that the
 * POS installs. If the builder cannot be reached, the POS keeps working for a grace period
 * counted from the last signed "active" answer it stored (or the licence's issue date), then
 * locks. Stored answers are signed by the builder, so editing them cannot extend the grace.
 */

export const CHECK_IN_GRACE_MS = 7 * 24 * 60 * 60 * 1000
export const CHECK_IN_TIMEOUT_MS = 10_000

/** What the builder said, or why it could not be asked. */
export type CheckInOutcome =
  { kind: 'answered'; status: unknown } | { kind: 'unreachable'; message: string }

export type CheckInVerdict =
  /** The builder confirmed this licence; store the answer as the new grace anchor. */
  | { kind: 'confirmed'; statusText: string }
  /** The licence is revoked; store the answer so a restart offline stays locked. */
  | { kind: 'revoked'; statusText: string }
  /** A newer licence to install in place of the current one. */
  | { kind: 'renewed'; licence: unknown }
  /** No usable answer: within the grace period until `lockAt`, or past it. */
  | { kind: 'grace'; lastConfirmedAt: string; lockAt: string; message: string }
  | { kind: 'overdue'; lastConfirmedAt: string; message: string }

function storedAnswer(
  storedStatusText: string | null,
  publicKeyPem: string,
  licenceId: string,
  now: Date,
) {
  if (!storedStatusText) return null
  const result = verifyLicenceStatus(storedStatusText, {
    publicKeyPem,
    licenceId,
    now,
    // Any age: a stored revocation never expires, and grace is measured separately.
    maxAgeMs: Number.POSITIVE_INFINITY,
  })
  return result.valid ? result.status : null
}

/**
 * Decides what a check-in means for `licence`. Pure apart from signature checks, so every path
 * is unit-tested; `checkLicence` does the network call and file writes.
 */
export function decideCheckIn(inputs: {
  licence: LicencePayload
  outcome: CheckInOutcome
  storedStatusText: string | null
  publicKeyPem: string
  now: Date
}): CheckInVerdict {
  const { licence, outcome, publicKeyPem, now } = inputs
  let failure = outcome.kind === 'unreachable' ? outcome.message : ''

  if (outcome.kind === 'answered') {
    const answer = verifyLicenceStatus(outcome.status, {
      publicKeyPem,
      licenceId: licence.licenceId,
      now,
    })
    if (answer.valid) {
      const statusText = JSON.stringify(outcome.status)
      switch (answer.status.status) {
        case 'active':
          return { kind: 'confirmed', statusText }
        case 'revoked':
          return { kind: 'revoked', statusText }
        case 'superseded':
          return { kind: 'renewed', licence: answer.status.licence }
      }
    }
    failure = `The licence server's answer was rejected: ${answer.valid ? '' : answer.message}`
  }

  const stored = storedAnswer(inputs.storedStatusText, publicKeyPem, licence.licenceId, now)
  if (stored?.status === 'revoked') {
    return { kind: 'revoked', statusText: inputs.storedStatusText! }
  }
  const anchors = [Date.parse(licence.issuedAt)]
  if (stored?.status === 'active') anchors.push(Date.parse(stored.checkedAt))
  const lastConfirmed = Math.max(...anchors)
  const lastConfirmedAt = new Date(lastConfirmed).toISOString()
  const lockAt = new Date(lastConfirmed + CHECK_IN_GRACE_MS)
  if (now.getTime() > lockAt.getTime()) {
    return {
      kind: 'overdue',
      lastConfirmedAt,
      message: `The licence has not been confirmed by the provider since ${lastConfirmedAt} (${failure})`,
    }
  }
  return { kind: 'grace', lastConfirmedAt, lockAt: lockAt.toISOString(), message: failure }
}

/** Asks the builder about `licenceFileText`; never throws. */
export async function callLicenceServer(
  serverUrl: string,
  licenceFileText: string,
  host: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckInOutcome> {
  try {
    const response = await fetchImpl(new URL('/api/licence-check', serverUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licence: JSON.parse(licenceFileText), host }),
      signal: AbortSignal.timeout(CHECK_IN_TIMEOUT_MS),
    })
    const body = (await response.json().catch(() => null)) as {
      status?: unknown
      error?: { message?: string }
    } | null
    if (!response.ok || !body?.status) {
      return {
        kind: 'unreachable',
        message: `licence server answered ${response.status}${body?.error?.message ? `: ${body.error.message}` : ''}`,
      }
    }
    return { kind: 'answered', status: body.status }
  } catch (error) {
    return {
      kind: 'unreachable',
      message: `licence server not reachable: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
