import { describe, expect, it } from 'vitest'

import { buildTaxBreakdown, calculateLineTax } from './tax.js'

describe('calculateLineTax: prices include tax', () => {
  it.each([
    [1180, 18, 180, 1000],
    [1000, 18, 153, 847],
    [100, 0, 0, 100],
    [0, 18, 0, 0],
    [105, 5, 5, 100],
  ])('%d at %d%% contains %d tax', (amount, rate, tax, totalExcludingTax) => {
    expect(calculateLineTax(amount, rate, true)).toEqual({ tax, total: amount, totalExcludingTax })
  })
})

describe('calculateLineTax: prices exclude tax', () => {
  it.each([
    [1000, 18, 180, 1180],
    [999, 18, 180, 1179],
    [25, 10, 3, 28],
    [1000, 8.875, 89, 1089],
    [100, 0, 0, 100],
  ])('%d at %d%% adds %d tax', (amount, rate, tax, total) => {
    expect(calculateLineTax(amount, rate, false)).toEqual({ tax, total, totalExcludingTax: amount })
  })

  it('rejects invalid rates', () => {
    expect(() => calculateLineTax(100, 101, false)).toThrow(
      expect.objectContaining({ code: 'invalid_percent' }),
    )
  })
})

describe('buildTaxBreakdown', () => {
  it('groups by rate in ascending order and keeps zero rates', () => {
    expect(
      buildTaxBreakdown([
        { taxRatePercent: 18, totalExcludingTax: 1000, tax: 180 },
        { taxRatePercent: 0, totalExcludingTax: 500, tax: 0 },
        { taxRatePercent: 18, totalExcludingTax: 200, tax: 36 },
        { taxRatePercent: 8.875, totalExcludingTax: 1000, tax: 89 },
      ]),
    ).toEqual([
      { taxRatePercent: 0, taxableAmount: 500, tax: 0 },
      { taxRatePercent: 8.875, taxableAmount: 1000, tax: 89 },
      { taxRatePercent: 18, taxableAmount: 1200, tax: 216 },
    ])
  })

  it('is empty for no lines', () => {
    expect(buildTaxBreakdown([])).toEqual([])
  })
})
