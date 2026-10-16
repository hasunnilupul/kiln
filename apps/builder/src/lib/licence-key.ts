import { publicKeyFromPrivate } from '@kiln/licence/sign'

export interface LicenceKeys {
  privateKeyPem: string
  publicKeyPem: string
}

/** `LICENCE_SIGNING_KEY` is missing or unusable; endpoints answer 503 with this message. */
export class LicenceKeyNotConfigured extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LicenceKeyNotConfigured'
  }
}

let cached: { value: string; keys: LicenceKeys } | undefined

/**
 * The builder's Ed25519 licence signing key from `LICENCE_SIGNING_KEY` (PKCS #8 PEM; `\n` escapes
 * allowed for one-line env files), and the public key every client build embeds (BR-31). The key
 * is never stored in the database. Losing it means no existing build can be renewed; replacing
 * it means rebuilding every client, so keep a backup in the secret store.
 */
export function licenceKeys(env: NodeJS.ProcessEnv = process.env): LicenceKeys {
  const value = env.LICENCE_SIGNING_KEY?.replace(/\\n/g, '\n').trim() ?? ''
  if (!value) {
    throw new LicenceKeyNotConfigured(
      'LICENCE_SIGNING_KEY is not set; generate one with pnpm licence:keygen',
    )
  }
  if (cached?.value !== value) {
    if (!value.startsWith('-----BEGIN PRIVATE KEY-----')) {
      throw new LicenceKeyNotConfigured(
        'LICENCE_SIGNING_KEY must be the whole PEM printed by pnpm licence:keygen, including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines',
      )
    }
    let publicKeyPem: string
    try {
      publicKeyPem = publicKeyFromPrivate(value)
    } catch (error) {
      throw new LicenceKeyNotConfigured(
        `LICENCE_SIGNING_KEY is not a usable Ed25519 private key (${(error as Error).message}); generate one with pnpm licence:keygen`,
      )
    }
    cached = { value, keys: { privateKeyPem: value, publicKeyPem } }
  }
  return cached.keys
}
