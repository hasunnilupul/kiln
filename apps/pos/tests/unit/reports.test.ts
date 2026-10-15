import { describe, expect, it } from 'vitest'

import { decimal, toCsv } from '@/lib/csv'
import { addDays, startOfZonedDay, zonedDay } from '@/lib/dates'
import { buildSalesReport, type ReportRefund, type ReportSale } from '@/lib/reports'

const cash = (amount: number) => ({ methodCode: 'cash', methodLabel: 'Cash', isCash: true, amount })
const card = (amount: number) => ({
  methodCode: 'card',
  methodLabel: 'Card',
  isCash: false,
  amount,
})
const cola = (quantity: number, total: number) => ({
  variantId: 1,
  sku: 'COLA',
  name: 'Cola',
  quantity,
  total,
})
const juice = (quantity: number, total: number) => ({
  variantId: 2,
  sku: 'OJ',
  name: 'Juice',
  quantity,
  total,
})

const sales: ReportSale[] = [
  {
    // 23:30 on the 14th in Colombo (UTC+5:30) is the 14th; in UTC it is 18:00 on the 14th.
    completedAt: '2026-10-14T18:00:00.000Z',
    outletId: 10,
    cashierId: 100,
    subtotal: 1000,
    discountTotal: 100,
    taxTotal: 137,
    total: 900,
    change: 100,
    payments: [cash(1000)],
    lines: [cola(2, 900)],
  },
  {
    // 00:30 on the 15th in Colombo.
    completedAt: '2026-10-14T19:00:00.000Z',
    outletId: 10,
    cashierId: 101,
    subtotal: 2000,
    discountTotal: 0,
    taxTotal: 305,
    total: 2000,
    change: 0,
    payments: [card(1500), cash(500)],
    lines: [juice(1, 1500), cola(1, 500)],
  },
]

const refunds: ReportRefund[] = [
  {
    createdAt: '2026-10-15T05:00:00.000Z',
    outletId: 10,
    processedById: 100,
    total: 450,
    taxTotal: 69,
    payouts: [cash(450)],
    lines: [cola(1, 450)],
  },
]

const report = buildSalesReport(sales, refunds, {
  timeZone: 'Asia/Colombo',
  days: ['2026-10-13', '2026-10-14', '2026-10-15'],
  categoryOf: (id) => (id === 1 ? 'Drinks' : null),
  userName: (id) => `User ${id}`,
  outletName: (id) => `Outlet ${id}`,
})

describe('buildSalesReport (FR-70, FR-71)', () => {
  it('totals the period net of refunds', () => {
    expect(report.totals).toEqual({
      salesCount: 2,
      gross: 3000,
      discounts: 100,
      tax: 442,
      total: 2900,
      refunds: 450,
      refundTax: 69,
      net: 2450,
    })
  })

  it('groups by calendar day in the client time zone, including quiet days', () => {
    expect(report.byDay.map((d) => [d.date, d.salesCount, d.total, d.refunds, d.net])).toEqual([
      ['2026-10-13', 0, 0, 0, 0],
      ['2026-10-14', 1, 900, 0, 900],
      ['2026-10-15', 1, 2000, 450, 1550],
    ])
  })

  it('splits payment methods with cash net of change and refunds', () => {
    expect(report.byPaymentMethod).toEqual([
      { code: 'card', method: 'Card', taken: 1500, refunded: 0, net: 1500 },
      { code: 'cash', method: 'Cash', taken: 1400, refunded: 450, net: 950 },
    ])
  })

  it('breaks down by product, category, cashier and outlet', () => {
    expect(
      report.byProduct.map((p) => [p.sku, p.quantity, p.total, p.refundedQuantity, p.net]),
    ).toEqual([
      ['OJ', 1, 1500, 0, 1500],
      ['COLA', 3, 1400, 1, 950],
    ])
    expect(report.byCategory.map((c) => [c.category, c.quantity, c.net])).toEqual([
      ['Uncategorised', 1, 1500],
      ['Drinks', 3, 950],
    ])
    expect(report.byCashier.map((c) => [c.cashier, c.salesCount, c.net])).toEqual([
      ['User 101', 1, 2000],
      ['User 100', 1, 450],
    ])
    expect(report.byOutlet).toEqual([expect.objectContaining({ outlet: 'Outlet 10', net: 2450 })])
  })
})

describe('time zone days', () => {
  it('finds midnight in the client time zone', () => {
    expect(startOfZonedDay('2026-10-15', 'Asia/Colombo').toISOString()).toBe(
      '2026-10-14T18:30:00.000Z',
    )
    expect(startOfZonedDay('2026-10-15', 'UTC').toISOString()).toBe('2026-10-15T00:00:00.000Z')
  })

  it('handles daylight saving changes', () => {
    // Clocks go back on 2026-10-25 in Berlin; the day starts at UTC+2.
    expect(startOfZonedDay('2026-10-25', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    )
    expect(startOfZonedDay('2026-10-26', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    )
  })

  it('reads the calendar day of an instant and adds days', () => {
    expect(zonedDay('2026-10-14T19:00:00.000Z', 'Asia/Colombo')).toBe('2026-10-15')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('CSV (FR-73)', () => {
  it('quotes, escapes and neutralises formulas', () => {
    const csv = toCsv(
      [
        { name: 'Cola, "large"', amount: 12.5 },
        { name: '=HYPERLINK("x")', amount: null },
        { name: '-5 discount', amount: -1 },
      ],
      [
        { header: 'Name', value: (r) => r.name },
        { header: 'Amount', value: (r) => r.amount },
      ],
    )
    expect(csv).toBe(
      'Name,Amount\r\n"Cola, ""large""",12.5\r\n"\'=HYPERLINK(""x"")",\r\n\'-5 discount,-1\r\n',
    )
  })

  it('writes minor units as plain decimals', () => {
    expect(decimal(1250, 2)).toBe('12.50')
    expect(decimal(-5, 2)).toBe('-0.05')
    expect(decimal(1234, 3)).toBe('1.234')
    expect(decimal(500, 0)).toBe('500')
  })
})
