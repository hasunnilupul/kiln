import { describe, expect, it } from 'vitest'

import { summariseShift } from './shift.js'

const cash = (amount: number) => ({ methodCode: 'cash', isCash: true, amount })
const card = (amount: number) => ({ methodCode: 'card', isCash: false, amount })

describe('summariseShift (FR-61, FR-72)', () => {
  it('is just the float for an empty shift', () => {
    expect(
      summariseShift({ openingFloat: 10000, sales: [], refunds: [], cashMovements: [] }),
    ).toEqual({
      openingFloat: 10000,
      salesCount: 0,
      salesTotal: 0,
      refundsCount: 0,
      refundsTotal: 0,
      cashIn: 0,
      cashOut: 0,
      byMethod: [],
      expectedCash: 10000,
    })
  })

  it('counts cash net of change, card, refunds and cash movements', () => {
    const summary = summariseShift({
      openingFloat: 10000,
      sales: [
        { total: 1180, change: 820, payments: [cash(2000)] },
        { total: 3000, change: 500, payments: [card(2000), cash(1500)] },
        { total: 999, change: 0, payments: [card(999)] },
      ],
      refunds: [{ total: 590, payouts: [cash(590)] }],
      cashMovements: [
        { type: 'in', amount: 5000 },
        { type: 'out', amount: 1200 },
      ],
    })
    expect(summary.byMethod).toEqual([
      { methodCode: 'cash', isCash: true, taken: 2180, refunded: 590, net: 1590 },
      { methodCode: 'card', isCash: false, taken: 2999, refunded: 0, net: 2999 },
    ])
    expect(summary).toMatchObject({
      salesCount: 3,
      salesTotal: 5179,
      refundsCount: 1,
      refundsTotal: 590,
      cashIn: 5000,
      cashOut: 1200,
      // 10000 + 1590 + 5000 − 1200
      expectedCash: 15390,
    })
  })

  it('takes change across several cash payments in order', () => {
    const summary = summariseShift({
      openingFloat: 0,
      sales: [{ total: 1000, change: 700, payments: [cash(500), cash(1200)] }],
      refunds: [],
      cashMovements: [],
    })
    expect(summary.byMethod[0]).toMatchObject({ taken: 1000 })
    expect(summary.expectedCash).toBe(1000)
  })

  it('rejects change larger than the cash tendered', () => {
    expect(() =>
      summariseShift({
        openingFloat: 0,
        sales: [{ total: 1000, change: 100, payments: [card(1100)] }],
        refunds: [],
        cashMovements: [],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_amount' }))
  })

  it.each([
    { openingFloat: -1, sales: [], refunds: [], cashMovements: [] },
    {
      openingFloat: 0,
      sales: [{ total: 1.5, change: 0, payments: [] }],
      refunds: [],
      cashMovements: [],
    },
    {
      openingFloat: 0,
      sales: [{ total: 1, change: -1, payments: [] }],
      refunds: [],
      cashMovements: [],
    },
    {
      openingFloat: 0,
      sales: [{ total: 1, change: 0, payments: [cash(-1)] }],
      refunds: [],
      cashMovements: [],
    },
    { openingFloat: 0, sales: [], refunds: [{ total: -1, payouts: [] }], cashMovements: [] },
    {
      openingFloat: 0,
      sales: [],
      refunds: [],
      cashMovements: [{ type: 'in' as const, amount: 0.5 }],
    },
  ])('rejects invalid amounts', (input) => {
    expect(() => summariseShift(input)).toThrow(expect.objectContaining({ code: 'invalid_amount' }))
  })
})
