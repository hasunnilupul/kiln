// Builder only. The POS must never import this module; it holds no keys, but signing has no
// place in a client build.
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto'

import {
  LICENCE_ALGORITHM,
  licencePayloadSchema,
  licenceStatusSchema,
  type LicenceFile,
  type LicencePayload,
  type LicenceStatus,
} from './licence.js'

export interface LicenceKeyPair {
  /** SPKI PEM, embedded in the POS. */
  publicKeyPem: string
  /** PKCS #8 PEM, kept only in the builder's secret store (BR-31). */
  privateKeyPem: string
}

/** Generates a new Ed25519 key pair for signing licences. */
export function generateLicenceKeyPair(): LicenceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKeyPem: publicKey, privateKeyPem: privateKey }
}

function loadPrivateKey(privateKeyPem: string): KeyObject {
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Licence signing key must be an Ed25519 private key')
  }
  return key
}

function signJson(value: unknown, privateKeyPem: string): LicenceFile {
  const key = loadPrivateKey(privateKeyPem)
  const payloadBytes = Buffer.from(JSON.stringify(value), 'utf8')
  return {
    alg: LICENCE_ALGORITHM,
    payload: payloadBytes.toString('base64url'),
    signature: sign(null, payloadBytes, key).toString('base64url'),
  }
}

/** Validates `payload` and signs it with the builder's Ed25519 private key. */
export function signLicence(payload: LicencePayload, privateKeyPem: string): LicenceFile {
  return signJson(licencePayloadSchema.parse(payload), privateKeyPem)
}

/** Validates and signs the builder's answer to a POS check-in (BR-32). */
export function signLicenceStatus(status: LicenceStatus, privateKeyPem: string): LicenceFile {
  return signJson(licenceStatusSchema.parse(status), privateKeyPem)
}

/** The SPKI PEM public key for a signing key, as embedded in client builds. */
export function publicKeyFromPrivate(privateKeyPem: string): string {
  return createPublicKey(loadPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString()
}

/** Text of `licence.json` as written into a build. */
export function serializeLicence(file: LicenceFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}
