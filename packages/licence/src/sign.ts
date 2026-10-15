// Builder only. The POS must never import this module; it holds no keys, but signing has no
// place in a client build.
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'

import {
  LICENCE_ALGORITHM,
  licencePayloadSchema,
  type LicenceFile,
  type LicencePayload,
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

/** Validates `payload` and signs it with the builder's Ed25519 private key. */
export function signLicence(payload: LicencePayload, privateKeyPem: string): LicenceFile {
  const validated = licencePayloadSchema.parse(payload)
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Licence signing key must be an Ed25519 private key')
  }
  const payloadBytes = Buffer.from(JSON.stringify(validated), 'utf8')
  return {
    alg: LICENCE_ALGORITHM,
    payload: payloadBytes.toString('base64url'),
    signature: sign(null, payloadBytes, key).toString('base64url'),
  }
}

/** Text of `licence.json` as written into a build. */
export function serializeLicence(file: LicenceFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}
