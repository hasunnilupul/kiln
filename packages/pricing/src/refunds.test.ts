import { describe, expect, it } from 'vitest'

import { calculateRefund, type RefundableLine } from './refunds.js'

const saleLines: RefundableLine[] = [
  { id: 'a', quantity: 3, total: 1000, tax: 153, taxRatePercent: 18, refundedQuantity: 0 },
  { id: 'b', quantity: 1, total: 500, tax: 0, taxRatePercent: 0, refundedQuantity: 0 },
]

describe('calculateRefund (FR-50, FR-51)', () => {
  it('refunds a whole sale', () => {
    expect(
      calculateRefund(saleLines, [
        { lineId: 'a', quantity: 3 },
        { lineId: 'b', quantity: 1 },
      ]),
    ).toEqual({
      lines: [
        { lineId: 'a', quantity: 3, total: 1000, tax: 153, taxRatePercent: 18 },
        { lineId: 'b', quantity: 1, total: 500, tax: 0, taxRatePercent: 0 },
      ],
      total: 1500,
      taxTotal: 153,
      taxBreakdown: [
        { taxRatePercent: 0, taxableAmount: 500, tax: 0 },
        { taxRatePercent: 18, taxableAmount: 847, tax: 153 },
      ],
    })
  })

  it('refunds unit by unit and adds up to exactly the line total', () => {
    const amounts: [number, number][] = []
    for (let refunded = 0; refunded < 3; refunded += 1) {
      const lines = saleLines.map((l) => (l.id === 'a' ? { ...l, refundedQuantity: refunded } : l))
      const refund = calculateRefund(lines, [{ lineId: 'a', quantity: 1 }])
      amounts.push([refund.total, refund.taxTotal])
    }
    expect(amounts).toEqual([
      [333, 51],
      [334, 51],
      [333, 51],
    ])
  })

  it('adds up exactly for any split of partial refunds', () => {
    const line: RefundableLine = {
      id: 'x',
      quantity: 7,
      total: 9999,
      tax: 1525,
      taxRatePercent: 18,
      refundedQuantity: 0,
    }
    for (const split of [
      [1, 6],
      [2, 2, 3],
      [3, 1, 1, 2],
      [1, 1, 1, 1, 1, 1, 1],
    ]) {
      let refunded = 0
      let total = 0
      let tax = 0
      for (const quantity of split) {
        const refund = calculateRefund(
          [{ ...line, refundedQuantity: refunded }],
          [{ lineId: 'x', quantity }],
        )
        total += refund.total
        tax += refund.taxTotal
        refunded += quantity
      }
      expect([total, tax]).toEqual([9999, 1525])
    }
  })

  it.each<[string, RefundableLine[], { lineId: string; quantity: number }[], string]>([
    ['an empty request', saleLines, [], 'empty_refund'],
    ['an unknown line', saleLines, [{ lineId: 'z', quantity: 1 }], 'unknown_line'],
    [
      'a repeated line',
      saleLines,
      [
        { lineId: 'a', quantity: 1 },
        { lineId: 'a', quantity: 1 },
      ],
      'duplicate_line',
    ],
    ['more than was sold', saleLines, [{ lineId: 'a', quantity: 4 }], 'refund_exceeds_quantity'],
    [
      'more than remains',
      [{ ...saleLines[0]!, refundedQuantity: 3 }],
      [{ lineId: 'a', quantity: 1 }],
      'refund_exceeds_quantity',
    ],
    [
      'a negative refunded quantity',
      [{ ...saleLines[0]!, refundedQuantity: -1 }],
      [{ lineId: 'a', quantity: 1 }],
      'refund_exceeds_quantity',
    ],
    [
      'a fractional refunded quantity',
      [{ ...saleLines[0]!, refundedQuantity: 0.5 }],
      [{ lineId: 'a', quantity: 1 }],
      'refund_exceeds_quantity',
    ],
    ['a zero quantity', saleLines, [{ lineId: 'a', quantity: 0 }], 'invalid_quantity'],
    [
      'a corrupt sale line',
      [{ ...saleLines[0]!, total: -5 }],
      [{ lineId: 'a', quantity: 1 }],
      'invalid_amount',
    ],
  ])('rejects %s', (_name, lines, request, code) => {
    expect(() => calculateRefund(lines, request)).toThrow(expect.objectContaining({ code }))
  })
})
