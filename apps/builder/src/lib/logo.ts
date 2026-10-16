import { createHash } from 'node:crypto'

/**
 * Branding logo files (BR-11): what the setup wizard accepts and where the config points at it.
 * A logo is stored once per client under a content-addressed path such as
 * `assets/logo-3f2a9c1b7d4e.png`, so a config version always builds with the logo it was saved
 * with, and a new logo is a visible change in the config diff.
 */

/** Logos are small; this keeps them cheap to store with each client and to ship in a build. */
export const MAX_LOGO_BYTES = 512 * 1024

export const LOGO_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
} as const
export type LogoExtension = keyof typeof LOGO_TYPES

/** `assets/logo-<12 hex>.<ext>`: the only logo paths the builder writes or serves. */
export const LOGO_PATH_PATTERN = /^assets\/logo-[0-9a-f]{12}\.(png|jpg|webp|svg)$/

export class InvalidLogo extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidLogo'
  }
}

const startsWith = (bytes: Buffer, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte)

/**
 * The file's real type from its first bytes; the name and declared type are not trusted. SVGs
 * must be plain drawings: the POS serves the logo from its own origin, so anything that could run
 * script or load other content is refused rather than cleaned up.
 */
export function detectLogoType(bytes: Buffer): LogoExtension {
  if (bytes.length === 0) throw new InvalidLogo('The file is empty')
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new InvalidLogo(`The logo must be at most ${MAX_LOGO_BYTES / 1024} KB`)
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp'

  const text = bytes.toString('utf8').replace(/^﻿/, '')
  // An optional XML declaration, comments and a plain DOCTYPE (no internal subset) may come first.
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^[>]*>\s*)*<svg[\s>/]/i.test(text)) {
    checkSvg(text)
    return 'svg'
  }
  throw new InvalidLogo('Use a PNG, JPEG, WebP or SVG image')
}

const UNSAFE_SVG = [
  { pattern: /<script[\s>/]/i, reason: 'scripts' },
  { pattern: /<foreignObject[\s>/]/i, reason: 'embedded HTML' },
  { pattern: /<!ENTITY/i, reason: 'XML entities' },
  { pattern: /\son[a-z]+\s*=/i, reason: 'event handlers' },
  { pattern: /javascript:/i, reason: 'javascript: links' },
  // Any href or url() that is not an in-document #reference or an embedded image.
  { pattern: /href\s*=\s*["'](?!#|data:image\/(png|jpeg|webp);)/i, reason: 'external links' },
  { pattern: /url\(\s*(?!["']?#)/i, reason: 'external resources' },
  { pattern: /@import/i, reason: 'external styles' },
]

function checkSvg(text: string) {
  for (const { pattern, reason } of UNSAFE_SVG) {
    if (pattern.test(text)) throw new InvalidLogo(`SVG logos must not contain ${reason}`)
  }
}

/** Validates `bytes` as a logo and returns where it is stored and what it is. */
export function describeLogo(bytes: Buffer): {
  path: string
  extension: LogoExtension
  mimeType: string
  sha256: string
  size: number
} {
  const extension = detectLogoType(bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    path: `assets/logo-${sha256.slice(0, 12)}.${extension}`,
    extension,
    mimeType: LOGO_TYPES[extension],
    sha256,
    size: bytes.length,
  }
}
