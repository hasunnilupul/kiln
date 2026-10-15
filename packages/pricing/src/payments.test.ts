import { describe, expect, it } from 'vitest'

import { settlePayments } from './payments.js'

describe('settlePayments (FR-40, FR-41)', () => {
  it('settles an exact cash payment', () => {
    expect(settlePayments(1180, [{ amount: 1180, isCash: true }])).toEqual({
      tendered: 1180,
      cashTendered: 1180,
      nonCashTendered: 0,
      remaining: 0,
      change: 0,
      isSettled: true,
    })
  })

  it('gives change on over-tendered cash', () => {
    expect(settlePayments(1180, [{ amount: 2000, isCash: true }])).toMatchObject({
      change: 820,
      isSettled: true,
    })
  })

  it('splits card and cash, with change from cash', () => {
    const settlement = settlePayments(3000, [
      { amount: 2000, isCash: false },
      { amount: 1500, isCash: true },
    ])
    expect(settlement).toMatchObject({
      nonCashTendered: 2000,
      cashTendered: 1500,
      change: 500,
      isSettled: true,
    })
    expect(settlement.tendered - settlement.change).toBe(3000)
  })

  it('reports the remaining balance when under-tendered', () => {
    expect(settlePayments(3000, [{ amount: 1000, isCash: false }])).toMatchObject({
      remaining: 2000,
      change: 0,
      isSettled: false,
    })
  })

  it('settles a zero total with no tenders', () => {
    expect(settlePayments(0, [])).toMatchObject({ tendered: 0, remaining: 0, isSettled: true })
  })

  it('rejects non-cash payments above the amount due', () => {
    expect(() => settlePayments(1000, [{ amount: 1001, isCash: false }])).toThrow(
      expect.objectContaining({ code: 'non_cash_overpayment' }),
    )
  })

  it.each([
    [-1, []],
    [100, [{ amount: 10.5, isCash: true }]],
    [100, [{ amount: -10, isCash: true }]],
  ])('rejects invalid amounts (total %d)', (total, tenders) => {
    expect(() => settlePayments(total, tenders)).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    )
  })
})
