import { createPublicKey, verify, type KeyObject } from 'node:crypto'

import { licenceFileSchema, licencePayloadSchema, type LicencePayload } from './licence.js'

/** Tolerance for clocks that run slightly behind the builder's when checking `issuedAt`. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000

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
 * Verifies `licence.json` (FR-04): Ed25519 signature, validity period and allowed host.
 * Accepts the file text or an already-parsed object. Never throws for a bad licence; throws only
 * when `publicKeyPem` itself is unusable.
 */
export function verifyLicence(file: unknown, options: VerifyLicenceOptions): LicenceVerification {
  const publicKey = loadPublicKey(options.publicKeyPem)

  let input = file
  if (typeof file === 'string') {
    try {
      input = JSON.parse(file)
    } catch {
      return fail('malformed', 'licence.json is not valid JSON')
    }
  }
  const parsedFile = licenceFileSchema.safeParse(input)
  if (!parsedFile.success) {
    return fail('malformed', 'licence.json does not have the expected shape')
  }

  const payloadBytes = Buffer.from(parsedFile.data.payload, 'base64url')
  const signature = Buffer.from(parsedFile.data.signature, 'base64url')
  if (!verify(null, payloadBytes, publicKey, signature)) {
    return fail('bad_signature', 'Licence signature is not valid')
  }

  let payloadJson: unknown
  try {
    payloadJson = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    return fail('malformed', 'Licence payload is not valid JSON')
  }
  const payload = licencePayloadSchema.safeParse(payloadJson)
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
