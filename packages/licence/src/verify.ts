import { createPublicKey, verify, type KeyObject } from 'node:crypto'

import {
  licenceFileSchema,
  licencePayloadSchema,
  licenceStatusSchema,
  type LicencePayload,
  type LicenceStatus,
} from './licence.js'

/** Tolerance for clocks that run slightly behind the builder's when checking `issuedAt`. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000

/** A check-in answer older (or further in the future) than this is rejected as a replay. */
export const STATUS_MAX_AGE_MS = 10 * 60 * 1000

export type LicenceFailureReason =
  'malformed' | 'bad_signature' | 'not_yet_valid' | 'expired' | 'host_not_allowed'

export type LicenceVerification =
  | { valid: true; licence: LicencePayload }
  | { valid: false; reason: LicenceFailureReason; message: string }

export interface VerifyLicenceOptions {
  /** The SPKI PEM public key embedded in the POS. */
  publicKeyPem: string
  /** The POS `PUBLIC_URL`; its hostname must be one of the licence's allowed hosts. */
  publicUrl: string
  now?: Date
}

/** Loads the embedded public key; throws if it is not an Ed25519 key. */
function loadPublicKey(pem: string): KeyObject {
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Licence public key must be an Ed25519 key')
  }
  return key
}

const fail = (reason: LicenceFailureReason, message: string): LicenceVerification => ({
  valid: false,
  reason,
  message,
})

/**
 * Checks the envelope and Ed25519 signature of a signed file and returns its decoded JSON
 * payload, or the reason it is unusable.
 */
function openSigned(
  file: unknown,
  publicKey: KeyObject,
  what: string,
):
  | { ok: true; json: unknown }
  | { ok: false; reason: 'malformed' | 'bad_signature'; message: string } {
  let input = file
  if (typeof file === 'string') {
    try {
      input = JSON.parse(file)
    } catch {
      return { ok: false, reason: 'malformed', message: `${what} is not valid JSON` }
    }
  }
  const parsedFile = licenceFileSchema.safeParse(input)
  if (!parsedFile.success) {
    return { ok: false, reason: 'malformed', message: `${what} does not have the expected shape` }
  }

  const payloadBytes = Buffer.from(parsedFile.data.payload, 'base64url')
  const signature = Buffer.from(parsedFile.data.signature, 'base64url')
  if (!verify(null, payloadBytes, publicKey, signature)) {
    return { ok: false, reason: 'bad_signature', message: `${what} signature is not valid` }
  }
  try {
    return { ok: true, json: JSON.parse(payloadBytes.toString('utf8')) }
  } catch {
    return { ok: false, reason: 'malformed', message: `${what} payload is not valid JSON` }
  }
}

/**
 * Verifies `licence.json` (FR-04): Ed25519 signature, validity period and allowed host.
 * Accepts the file text or an already-parsed object. Never throws for a bad licence; throws only
 * when `publicKeyPem` itself is unusable.
 */
export function verifyLicence(file: unknown, options: VerifyLicenceOptions): LicenceVerification {
  const publicKey = loadPublicKey(options.publicKeyPem)

  const opened = openSigned(file, publicKey, 'Licence')
  if (!opened.ok) return fail(opened.reason, opened.message)
  const payload = licencePayloadSchema.safeParse(opened.json)
  if (!payload.success) {
    return fail('malformed', 'Licence payload does not have the expected shape')
  }
  const licence = payload.data

  const now = (options.now ?? new Date()).getTime()
  if (now < Date.parse(licence.issuedAt) - CLOCK_SKEW_MS) {
    return fail('not_yet_valid', `Licence is not valid before ${licence.issuedAt}`)
  }
  if (now >= Date.parse(licence.expiresAt)) {
    return fail('expired', `Licence expired at ${licence.expiresAt}`)
  }

  let host: string
  try {
    host = new URL(options.publicUrl).hostname.toLowerCase()
  } catch {
    return fail('host_not_allowed', `PUBLIC_URL "${options.publicUrl}" is not a valid URL`)
  }
  if (!licence.allowedHosts.includes(host)) {
    return fail('host_not_allowed', `Host "${host}" is not licensed`)
  }

  return { valid: true, licence }
}

/**
 * The payload of a licence whose signature is valid, ignoring expiry and host. The builder uses
 * it to recognise a POS checking in, including one whose licence has just expired.
 */
export function readSignedLicence(
  file: unknown,
  publicKeyPem: string,
): { valid: true; licence: LicencePayload } | { valid: false; message: string } {
  const opened = openSigned(file, loadPublicKey(publicKeyPem), 'Licence')
  if (!opened.ok) return { valid: false, message: opened.message }
  const payload = licencePayloadSchema.safeParse(opened.json)
  return payload.success
    ? { valid: true, licence: payload.data }
    : { valid: false, message: 'Licence payload does not have the expected shape' }
}

export type LicenceStatusVerification =
  | { valid: true; status: LicenceStatus }
  | {
      valid: false
      reason: 'malformed' | 'bad_signature' | 'wrong_licence' | 'stale'
      message: string
    }

/**
 * Verifies the builder's signed answer to a check-in (BR-32): signature, that it is about
 * `licenceId`, and that it is fresh, so an old "active" answer cannot be replayed after a
 * revocation. A `superseded` answer's new licence still has to pass {@link verifyLicence}.
 */
export function verifyLicenceStatus(
  file: unknown,
  options: {
    publicKeyPem: string
    licenceId: string
    now?: Date
    /** How old an answer may be; the POS passes its grace period for a stored answer. */
    maxAgeMs?: number
  },
): LicenceStatusVerification {
  const publicKey = loadPublicKey(options.publicKeyPem)
  const opened = openSigned(file, publicKey, 'Licence status')
  if (!opened.ok) return { valid: false, reason: opened.reason, message: opened.message }

  const parsed = licenceStatusSchema.safeParse(opened.json)
  if (!parsed.success) {
    return {
      valid: false,
      reason: 'malformed',
      message: 'Licence status does not have the expected shape',
    }
  }
  const status = parsed.data
  if (status.licenceId !== options.licenceId) {
    return {
      valid: false,
      reason: 'wrong_licence',
      message: `Licence status is for ${status.licenceId}`,
    }
  }
  const age = (options.now ?? new Date()).getTime() - Date.parse(status.checkedAt)
  // Never from the future beyond normal clock skew; never older than allowed.
  if (age < -STATUS_MAX_AGE_MS || age > (options.maxAgeMs ?? STATUS_MAX_AGE_MS)) {
    return {
      valid: false,
      reason: 'stale',
      message: `Licence status from ${status.checkedAt} is too old`,
    }
  }
  return { valid: true, status }
}
