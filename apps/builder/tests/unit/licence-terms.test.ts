import { describe, expect, it } from 'vitest'

import { addMonths, licenceExpiry, newLicenceId } from '@/lib/licence-terms'

describe('licence terms (BR-30)', () => {
  const issued = new Date('2026-10-16T09:30:00.000Z')

  it('expire after one, three or twelve calendar months', () => {
    expect(licenceExpiry(issued, 'trial').toISOString()).toBe('2026-11-16T09:30:00.000Z')
    expect(licenceExpiry(issued, '3m').toISOString()).toBe('2027-01-16T09:30:00.000Z')
    expect(licenceExpiry(issued, '12m').toISOString()).toBe('2027-10-16T09:30:00.000Z')
  })

  it('clamp to the end of a shorter month', () => {
    expect(addMonths(new Date('2027-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    )
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    )
    expect(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    )
  })

  it('get unique, readable ids', () => {
    const ids = new Set(Array.from({ length: 100 }, newLicenceId))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(/^lic_[a-z2-9]{12}$/)
  })
})
