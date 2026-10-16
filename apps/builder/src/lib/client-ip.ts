import ipaddr from 'ipaddr.js'

/**
 * The caller's IP address. The builder runs behind a proxy that sets these headers (Vercel, or
 * nginx/Caddy on a VPS), so the first `x-forwarded-for` entry is the client. Without such a proxy
 * the headers are client-controlled; deploy accordingly.
 */
export function clientIp(headers: Headers): string | null {
  const candidates = [headers.get('x-real-ip'), headers.get('x-forwarded-for')?.split(',')[0]]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value && ipaddr.isValid(value)) return normaliseIp(value)
  }
  return null
}

/** Canonical text form; IPv4-mapped IPv6 (`::ffff:1.2.3.4`) becomes plain IPv4. */
export function normaliseIp(value: string): string {
  const parsed = ipaddr.parse(value)
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (parsed as ipaddr.IPv6).toIPv4Address().toString()
  }
  return parsed.toNormalizedString()
}

type Range = [ipaddr.IPv4 | ipaddr.IPv6, number]

/**
 * Parses `BUILDER_IP_ALLOWLIST` (BR-03): comma- or space-separated addresses and CIDR ranges,
 * e.g. `203.0.113.7, 198.51.100.0/24, 2001:db8::/32`. Empty means no allowlist. Throws on an
 * invalid entry so a typo cannot silently open or close the builder.
 */
export function parseAllowlist(value: string | undefined): Range[] | null {
  const entries = (value ?? '').split(/[\s,]+/).filter(Boolean)
  if (entries.length === 0) return null
  return entries.map((entry) => {
    try {
      if (entry.includes('/')) return ipaddr.parseCIDR(entry)
      const address = ipaddr.parse(normaliseIp(entry))
      return [address, address.kind() === 'ipv4' ? 32 : 128] as Range
    } catch {
      throw new Error(`BUILDER_IP_ALLOWLIST: "${entry}" is not an IP address or CIDR range`)
    }
  })
}

/** True when `ip` falls inside one of the ranges. */
export function isAllowed(ip: string | null, ranges: Range[]): boolean {
  if (!ip) return false
  const address = ipaddr.parse(normaliseIp(ip))
  return ranges.some(
    ([range, bits]) => address.kind() === range.kind() && address.match(range, bits),
  )
}
