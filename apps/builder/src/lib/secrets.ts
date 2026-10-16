import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Small crypto helpers keyed off `PAYLOAD_SECRET`. Each use derives its own key from a purpose
 * string, so a token minted for one purpose never verifies for another. Rotating
 * `PAYLOAD_SECRET` invalidates everything sealed with it, including stored TOTP secrets.
 */

function deriveKey(secret: string, purpose: string): Buffer {
  if (secret.length < 32) throw new Error('PAYLOAD_SECRET must be at least 32 characters')
  return createHash('sha256').update(`kiln-builder:${purpose}:`).update(secret).digest()
}

/** Encrypts `plaintext` with AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function seal(plaintext: string, secret: string, purpose: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, purpose), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

/** Reverses `seal`; throws when the value was tampered with or sealed under another key. */
export function unseal(sealed: string, secret: string, purpose: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) {
    throw new Error('Not a sealed value')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret, purpose),
    Buffer.from(iv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** A short-lived token: base64url JSON claims plus an HMAC-SHA256 over them. */
export function signToken(
  claims: Record<string, unknown>,
  secret: string,
  purpose: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + ttlSeconds }),
  ).toString('base64url')
  const mac = createHmac('sha256', deriveKey(secret, purpose)).update(body).digest('base64url')
  return `${body}.${mac}`
}

/** The claims of a valid, unexpired token from `signToken`, or null. */
export function verifyToken(
  token: string,
  secret: string,
  purpose: string,
  now: number = Date.now(),
): Record<string, unknown> | null {
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', deriveKey(secret, purpose)).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims !== 'object' || claims === null) return null
  const exp = (claims as { exp?: unknown }).exp
  if (typeof exp !== 'number' || exp * 1000 <= now) return null
  return claims as Record<string, unknown>
}
