import { publicKeyFromPrivate } from '@kiln/licence/sign'

export interface LicenceKeys {
  privateKeyPem: string
  publicKeyPem: string
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
    throw new Error('LICENCE_SIGNING_KEY is not set; generate one with pnpm licence:keygen')
  }
  if (cached?.value !== value) {
    cached = { value, keys: { privateKeyPem: value, publicKeyPem: publicKeyFromPrivate(value) } }
  }
  return cached.keys
}
