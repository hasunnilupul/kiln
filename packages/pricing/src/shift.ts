import { PricingError } from './errors.js'
import { assertMoney, type Money } from './rounding.js'

export interface ShiftPayment {
  methodCode: string
  isCash: boolean
  amount: Money
}

export interface ShiftSaleInput {
  total: Money
  /** Cash handed back; taken out of the sale's cash payments. */
  change: Money
  payments: readonly ShiftPayment[]
}

export interface ShiftRefundInput {
  total: Money
  payouts: readonly ShiftPayment[]
}

export interface CashMovementInput {
  type: 'in' | 'out'
  amount: Money
}

export interface ShiftInput {
  openingFloat: Money
  sales: readonly ShiftSaleInput[]
  refunds: readonly ShiftRefundInput[]
  cashMovements: readonly CashMovementInput[]
}

export interface ShiftMethodTotal {
  methodCode: string
  isCash: boolean
  /** Taken in sales, net of change for cash. */
  taken: Money
  /** Paid out in refunds. */
  refunded: Money
  /** `taken − refunded`; may be negative. */
  net: Money
}

export interface ShiftSummary {
  openingFloat: Money
  salesCount: number
  salesTotal: Money
  refundsCount: number
  refundsTotal: Money
  cashIn: Money
  cashOut: Money
  /** Per payment method, in order of first use. */
  byMethod: ShiftMethodTotal[]
  /** Cash that should be in the drawer (FR-61). */
  expectedCash: Money
}

/**
 * Totals a shift for its close summary and shift report (FR-61, FR-72):
 * `expectedCash = openingFloat + cash taken − change + cash in − cash out − cash refunded`.
 */
export function summariseShift(input: ShiftInput): ShiftSummary {
  assertMoney(input.openingFloat, 'openingFloat')
  const methods = new Map<string, ShiftMethodTotal>()
  const method = (payment: ShiftPayment, name: string): ShiftMethodTotal => {
    assertMoney(payment.amount, `${name}.amount`)
    const entry = methods.get(payment.methodCode) ?? {
      methodCode: payment.methodCode,
      isCash: payment.isCash,
      taken: 0,
      refunded: 0,
      net: 0,
    }
    methods.set(payment.methodCode, entry)
    return entry
  }

  let salesTotal = 0
  input.sales.forEach((sale, s) => {
    assertMoney(sale.total, `sales[${s}].total`)
    assertMoney(sale.change, `sales[${s}].change`)
    let changeLeft = sale.change
    sale.payments.forEach((payment, p) => {
      const entry = method(payment, `sales[${s}].payments[${p}]`)
      let amount = payment.amount
      if (payment.isCash) {
        const fromThis = Math.min(amount, changeLeft)
        amount -= fromThis
        changeLeft -= fromThis
      }
      entry.taken += amount
    })
    if (changeLeft > 0) {
      throw new PricingError('invalid_amount', `sales[${s}] gave more change than cash tendered`)
    }
    salesTotal += sale.total
  })

  let refundsTotal = 0
  input.refunds.forEach((refund, r) => {
    assertMoney(refund.total, `refunds[${r}].total`)
    refund.payouts.forEach((payout, p) => {
      method(payout, `refunds[${r}].payouts[${p}]`).refunded += payout.amount
    })
    refundsTotal += refund.total
  })

  let cashIn = 0
  let cashOut = 0
  input.cashMovements.forEach((movement, m) => {
    assertMoney(movement.amount, `cashMovements[${m}].amount`)
    if (movement.type === 'in') cashIn += movement.amount
    else cashOut += movement.amount
  })

  const byMethod = [...methods.values()].map((entry) => ({
    ...entry,
    net: entry.taken - entry.refunded,
  }))
  const cashNet = byMethod
    .filter((entry) => entry.isCash)
    .reduce((sum, entry) => sum + entry.net, 0)
  return {
    openingFloat: input.openingFloat,
    salesCount: input.sales.length,
    salesTotal,
    refundsCount: input.refunds.length,
    refundsTotal,
    cashIn,
    cashOut,
    byMethod,
    expectedCash: input.openingFloat + cashNet + cashIn - cashOut,
  }
}
