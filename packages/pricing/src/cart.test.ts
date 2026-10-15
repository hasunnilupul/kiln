import { describe, expect, it } from 'vitest'

import { calculateCart, discountAmount, type CartInput, type CartLineInput } from './cart.js'

const line = (
  unitPrice: number,
  quantity = 1,
  taxRatePercent = 18,
  extra: Partial<CartLineInput> = {},
) => ({
  unitPrice,
  quantity,
  taxRatePercent,
  ...extra,
})

describe('calculateCart (FR-32)', () => {
  it('prices a tax-inclusive cart without discounts', () => {
    const cart = calculateCart({ pricesIncludeTax: true, lines: [line(590, 2)] })
    expect(cart).toEqual({
      lines: [
        {
          unitPrice: 590,
          quantity: 2,
          taxRatePercent: 18,
          gross: 1180,
          lineDiscount: 0,
          cartDiscount: 0,
          discountedAmount: 1180,
          tax: 180,
          totalExcludingTax: 1000,
          total: 1180,
        },
      ],
      subtotal: 1180,
      discountTotal: 0,
      taxTotal: 180,
      total: 1180,
      taxBreakdown: [{ taxRatePercent: 18, taxableAmount: 1000, tax: 180 }],
    })
  })

  it('applies a percent line discount before tax-exclusive tax (FR-31)', () => {
    const cart = calculateCart({
      pricesIncludeTax: false,
      lines: [line(1000, 3, 18, { discount: { type: 'percent', percent: 10 } })],
    })
    expect(cart.lines[0]).toMatchObject({
      gross: 3000,
      lineDiscount: 300,
      discountedAmount: 2700,
      tax: 486,
      total: 3186,
    })
    expect(cart).toMatchObject({ subtotal: 3000, discountTotal: 300, taxTotal: 486, total: 3186 })
  })

  it('applies an amount line discount', () => {
    const cart = calculateCart({
      pricesIncludeTax: true,
      lines: [line(1180, 1, 18, { discount: { type: 'amount', amount: 180 } })],
    })
    expect(cart.lines[0]).toMatchObject({
      lineDiscount: 180,
      discountedAmount: 1000,
      tax: 153,
      total: 1000,
    })
  })

  it('spreads an amount cart discount across lines so shares sum exactly (FR-31)', () => {
    const cart = calculateCart({
      pricesIncludeTax: false,
      lines: [line(1000, 1, 10), line(2000, 1, 10)],
      cartDiscount: { type: 'amount', amount: 100 },
    })
    expect(cart.lines.map((l) => l.cartDiscount)).toEqual([33, 67])
    expect(cart.lines.map((l) => l.tax)).toEqual([97, 193])
    expect(cart).toMatchObject({ subtotal: 3000, discountTotal: 100, taxTotal: 290, total: 3190 })
  })

  it('applies a percent cart discount after line discounts', () => {
    const cart = calculateCart({
      pricesIncludeTax: true,
      lines: [line(1000, 1, 18, { discount: { type: 'amount', amount: 200 } }), line(200)],
      cartDiscount: { type: 'percent', percent: 50 },
    })
    expect(cart.lines.map((l) => [l.lineDiscount, l.cartDiscount, l.discountedAmount])).toEqual([
      [200, 400, 400],
      [0, 100, 100],
    ])
    expect(cart).toMatchObject({ subtotal: 1200, discountTotal: 700, total: 500 })
  })

  it('handles a 100% cart discount', () => {
    const cart = calculateCart({
      pricesIncludeTax: true,
      lines: [line(500, 2)],
      cartDiscount: { type: 'percent', percent: 100 },
    })
    expect(cart).toMatchObject({ discountTotal: 1000, taxTotal: 0, total: 0 })
  })

  it('builds a tax breakdown across rates', () => {
    const cart = calculateCart({
      pricesIncludeTax: false,
      lines: [line(1000, 1, 18), line(500, 1, 0), line(200, 1, 18)],
    })
    expect(cart.taxBreakdown).toEqual([
      { taxRatePercent: 0, taxableAmount: 500, tax: 0 },
      { taxRatePercent: 18, taxableAmount: 1200, tax: 216 },
    ])
    expect(cart.total).toBe(1916)
  })

  it('prices an empty cart as zero', () => {
    expect(calculateCart({ pricesIncludeTax: true, lines: [] })).toEqual({
      lines: [],
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      total: 0,
      taxBreakdown: [],
    })
  })

  it('allows a zero cart discount on free items', () => {
    const cart = calculateCart({
      pricesIncludeTax: true,
      lines: [line(0, 2)],
      cartDiscount: { type: 'amount', amount: 0 },
    })
    expect(cart).toMatchObject({ discountTotal: 0, total: 0 })
  })

  it.each<[string, CartInput, string]>([
    ['a negative price', { pricesIncludeTax: true, lines: [line(-1)] }, 'invalid_amount'],
    ['a fractional price', { pricesIncludeTax: true, lines: [line(1.5)] }, 'invalid_amount'],
    ['a zero quantity', { pricesIncludeTax: true, lines: [line(100, 0)] }, 'invalid_quantity'],
    [
      'a fractional quantity',
      { pricesIncludeTax: true, lines: [line(100, 1.5)] },
      'invalid_quantity',
    ],
    [
      'an overflowing line',
      { pricesIncludeTax: true, lines: [line(Number.MAX_SAFE_INTEGER, 2)] },
      'invalid_amount',
    ],
    ['a bad tax rate', { pricesIncludeTax: true, lines: [line(100, 1, 120)] }, 'invalid_percent'],
    [
      'a line discount above the line',
      {
        pricesIncludeTax: true,
        lines: [line(100, 1, 18, { discount: { type: 'amount', amount: 101 } })],
      },
      'discount_exceeds_amount',
    ],
    [
      'a negative discount',
      {
        pricesIncludeTax: true,
        lines: [line(100, 1, 18, { discount: { type: 'amount', amount: -1 } })],
      },
      'invalid_amount',
    ],
    [
      'a percent above 100',
      {
        pricesIncludeTax: true,
        lines: [line(100, 1, 18, { discount: { type: 'percent', percent: 150 } })],
      },
      'invalid_percent',
    ],
    [
      'a cart discount above the cart',
      { pricesIncludeTax: true, lines: [line(100)], cartDiscount: { type: 'amount', amount: 101 } },
      'discount_exceeds_amount',
    ],
    [
      'a cart discount on an empty cart',
      { pricesIncludeTax: true, lines: [], cartDiscount: { type: 'amount', amount: 1 } },
      'discount_exceeds_amount',
    ],
  ])('rejects %s', (_name, input, code) => {
    expect(() => calculateCart(input)).toThrow(expect.objectContaining({ code }))
  })
})

describe('discountAmount', () => {
  it('rounds percent discounts half away from zero', () => {
    expect(discountAmount(25, { type: 'percent', percent: 10 }, 'd')).toBe(3)
    expect(discountAmount(24, { type: 'percent', percent: 10 }, 'd')).toBe(2)
  })
})

/** Small deterministic PRNG so the invariant test is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('cart invariants', () => {
  it('hold for 500 random carts', () => {
    const random = mulberry32(42)
    const int = (max: number) => Math.floor(random() * (max + 1))
    const rates = [0, 5, 8.875, 15, 18]

    for (let run = 0; run < 500; run += 1) {
      const pricesIncludeTax = random() < 0.5
      const lines = Array.from({ length: 1 + int(5) }, () => {
        const unitPrice = int(50_000)
        const quantity = 1 + int(9)
        const discount =
          random() < 0.3
            ? random() < 0.5
              ? { type: 'percent' as const, percent: int(100) }
              : { type: 'amount' as const, amount: int(unitPrice * quantity) }
            : undefined
        return { unitPrice, quantity, taxRatePercent: rates[int(rates.length - 1)]!, discount }
      })
      const cartDiscount =
        random() < 0.3 ? { type: 'percent' as const, percent: int(100) } : undefined
      const cart = calculateCart({ pricesIncludeTax, lines, cartDiscount })

      const sum = (pick: (l: (typeof cart.lines)[number]) => number) =>
        cart.lines.reduce((total, l) => total + pick(l), 0)
      expect(cart.total).toBe(sum((l) => l.total))
      expect(cart.taxTotal).toBe(sum((l) => l.tax))
      expect(cart.taxTotal).toBe(cart.taxBreakdown.reduce((total, entry) => total + entry.tax, 0))
      expect(cart.total).toBe(
        cart.subtotal - cart.discountTotal + (pricesIncludeTax ? 0 : cart.taxTotal),
      )
      for (const l of cart.lines) {
        expect(l.discountedAmount).toBeGreaterThanOrEqual(0)
        expect(l.tax).toBeGreaterThanOrEqual(0)
        expect(l.total).toBe(l.totalExcludingTax + l.tax)
      }
    }
  })
})
