import { PricingError } from './errors.js'
import { assertMoney, type Money } from './rounding.js'

export interface Tender {
  amount: Money
  /** Only cash can be over-tendered; change is always given in cash. */
  isCash: boolean
}

export interface PaymentSettlement {
  tendered: Money
  cashTendered: Money
  nonCashTendered: Money
  /** Still to pay; 0 once settled. */
  remaining: Money
  /** Cash to hand back; at most `cashTendered`. */
  change: Money
  isSettled: boolean
}

/**
 * Applies tenders (possibly split across methods, FR-40) to an amount due and works out change
 * (FR-41). Non-cash tenders may not exceed the amount due. When settled,
 * `total = tendered − change`.
 */
export function settlePayments(total: Money, tenders: readonly Tender[]): PaymentSettlement {
  assertMoney(total, 'total')
  let cashTendered = 0
  let nonCashTendered = 0
  tenders.forEach((tender, index) => {
    assertMoney(tender.amount, `tenders[${index}].amount`)
    if (tender.isCash) {
      cashTendered += tender.amount
    } else {
      nonCashTendered += tender.amount
    }
  })
  if (nonCashTendered > total) {
    throw new PricingError('non_cash_overpayment', 'Non-cash payments cannot exceed the amount due')
  }
  const tendered = cashTendered + nonCashTendered
  return {
    tendered,
    cashTendered,
    nonCashTendered,
    remaining: Math.max(0, total - tendered),
    change: Math.max(0, tendered - total),
    isSettled: tendered >= total,
  }
}
