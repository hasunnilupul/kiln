import { describe, expect, it } from 'vitest'

import { formatDateTime } from '@/lib/dates'

describe('formatDateTime', () => {
  const instant = '2026-10-15T20:05:00.000Z'

  it.each([
    ['yyyy-MM-dd', 'UTC', '2026-10-15 20:05'],
    ['dd/MM/yyyy', 'Asia/Colombo', '16/10/2026 01:35'],
    ['MM/dd/yyyy', 'America/New_York', '10/15/2026 16:05'],
    ['dd.MM.yyyy', 'Europe/Berlin', '15.10.2026 22:05'],
  ])('%s in %s', (pattern, timeZone, expected) => {
    expect(formatDateTime(instant, { pattern, timeZone })).toBe(expected)
  })

  it('can omit the time', () => {
    expect(
      formatDateTime(instant, { pattern: 'dd-MM-yyyy', timeZone: 'UTC', withTime: false }),
    ).toBe('15-10-2026')
  })
})
