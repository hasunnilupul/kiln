import { describe, expect, it } from 'vitest'

import { clientIp, isAllowed, normaliseIp, parseAllowlist } from '@/lib/client-ip'
import { isLoginLimited } from '@/lib/login-limit'

describe('clientIp', () => {
  it('prefers x-real-ip, then the first x-forwarded-for entry', () => {
    expect(
      clientIp(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' })),
    ).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe(
      '198.51.100.4',
    )
  })

  it('ignores invalid values and returns null without headers', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull()
    expect(clientIp(new Headers())).toBeNull()
  })

  it('normalises IPv4-mapped IPv6', () => {
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })
})

describe('IP allowlist (BR-03)', () => {
  it('is off when empty', () => {
    expect(parseAllowlist(undefined)).toBeNull()
    expect(parseAllowlist(' , ')).toBeNull()
  })

  it('matches single addresses and CIDR ranges, IPv4 and IPv6', () => {
    const ranges = parseAllowlist('203.0.113.7, 198.51.100.0/24 2001:db8::/32')!
    expect(isAllowed('203.0.113.7', ranges)).toBe(true)
    expect(isAllowed('203.0.113.8', ranges)).toBe(false)
    expect(isAllowed('198.51.100.200', ranges)).toBe(true)
    expect(isAllowed('::ffff:198.51.100.1', ranges)).toBe(true)
    expect(isAllowed('2001:db8::1', ranges)).toBe(true)
    expect(isAllowed('2001:db9::1', ranges)).toBe(false)
    expect(isAllowed(null, ranges)).toBe(false)
  })

  it('throws on a typo rather than opening or closing the builder', () => {
    expect(() => parseAllowlist('203.0.113.7, 198.51.100/24x')).toThrow('BUILDER_IP_ALLOWLIST')
  })
})

describe('isLoginLimited (BR-02)', () => {
  it('limits at five failures per IP or per account', () => {
    expect(isLoginLimited({ byIp: 4, byAccount: 4 })).toBe(false)
    expect(isLoginLimited({ byIp: 5, byAccount: 0 })).toBe(true)
    expect(isLoginLimited({ byIp: 0, byAccount: 5 })).toBe(true)
  })
})
