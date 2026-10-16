import { PricingError } from './errors.js'
import {
  PPM_PER_WHOLE,
  allocateProportionally,
  assertMoney,
  assertQuantity,
  multiplyMoney,
  mulDivRound,
  percentToPpm,
  type Money,
} from './rounding.js'
import { buildTaxBreakdown, calculateLineTax, type TaxBreakdownEntry } from './tax.js'

/** A fixed amount off, or a percentage off (up to 4 decimal places). */
export type Discount = { type: 'amount'; amount: Money } | { type: 'percent'; percent: number }

export interface CartLineInput {
  /** Price of one unit, in minor units; tax-inclusive or exclusive per `pricesIncludeTax`. */
  unitPrice: Money
  quantity: number
  taxRatePercent: number
  discount?: Discount
}

export interface CartInput {
  pricesIncludeTax: boolean
  lines: readonly CartLineInput[]
  /** Applied after line discounts and spread across lines in proportion to their amounts. */
  cartDiscount?: Discount
}

export interface CartLine {
  unitPrice: Money
  quantity: number
  taxRatePercent: number
  /** `unitPrice × quantity`. */
  gross: Money
  lineDiscount: Money
  /** This line's share of the cart discount. */
  cartDiscount: Money
  /** `gross − lineDiscount − cartDiscount`, in the same tax basis as `unitPrice`. */
  discountedAmount: Money
  tax: Money
  totalExcludingTax: Money
  /** What the customer pays for this line, tax included. */
  total: Money
}

export interface CartTotals {
  lines: CartLine[]
  /** Sum of line `gross`. */
  subtotal: Money
  /** Line discounts plus the cart discount. */
  discountTotal: Money
  taxTotal: Money
  /** Amount due, tax included. */
  total: Money
  taxBreakdown: TaxBreakdownEntry[]
}

/** The amount a discount takes off `base`; never more than `base`. */
export function discountAmount(base: Money, discount: Discount, name: string): Money {
  if (discount.type === 'percent') {
    return mulDivRound(base, percentToPpm(discount.percent, `${name} percent`), PPM_PER_WHOLE)
  }
  assertMoney(discount.amount, `${name} amount`)
  if (discount.amount > base) {
    throw new PricingError(
      'discount_exceeds_amount',
      `${name} is larger than the amount it applies to`,
    )
  }
  return discount.amount
}

/**
 * Prices a cart (FR-31, FR-32). Used by the till for display and by the server, which is the
 * pricing authority, at finalisation. Invariants:
 * - `total = subtotal − discountTotal` when prices include tax;
 * - `total = subtotal − discountTotal + taxTotal` when they do not;
 * - every total equals the sum of the matching line values.
 */
export function calculateCart(input: CartInput): CartTotals {
  const afterLineDiscount = input.lines.map((line, index) => {
    const name = `lines[${index}]`
    assertMoney(line.unitPrice, `${name}.unitPrice`)
    assertQuantity(line.quantity, `${name}.quantity`)
    const gross = multiplyMoney(line.unitPrice, line.quantity, `${name} gross`)
    const lineDiscount = line.discount
      ? discountAmount(gross, line.discount, `${name}.discount`)
      : 0
    return { line, gross, lineDiscount, amount: gross - lineDiscount }
  })

  const cartBase = afterLineDiscount.reduce((sum, line) => sum + line.amount, 0)
  const cartDiscount = input.cartDiscount
    ? discountAmount(cartBase, input.cartDiscount, 'cartDiscount')
    : 0
  const cartShares = allocateProportionally(
    cartDiscount,
    afterLineDiscount.map((line) => line.amount),
  )

  const lines = afterLineDiscount.map(({ line, gross, lineDiscount, amount }, index): CartLine => {
    const share = cartShares[index]!
    const discountedAmount = amount - share
    return {
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      taxRatePercent: line.taxRatePercent,
      gross,
      lineDiscount,
      cartDiscount: share,
      discountedAmount,
      ...calculateLineTax(discountedAmount, line.taxRatePercent, input.pricesIncludeTax),
    }
  })

  const sum = (pick: (line: CartLine) => Money) =>
    lines.reduce((total, line) => total + pick(line), 0)
  return {
    lines,
    subtotal: sum((line) => line.gross),
    discountTotal: sum((line) => line.lineDiscount + line.cartDiscount),
    taxTotal: sum((line) => line.tax),
    total: sum((line) => line.total),
    taxBreakdown: buildTaxBreakdown(lines),
  }
}

/**
 * True when `discount` is more than `limitPercent` of `base` (FR-13), compared exactly in
 * integers. A discount on a zero base exceeds any limit only if it is itself non-zero.
 */
export function discountExceedsLimit(discount: Money, base: Money, limitPercent: number): boolean {
  assertMoney(discount, 'discount')
  assertMoney(base, 'base')
  const limitPpm = percentToPpm(limitPercent, 'limitPercent')
  return BigInt(discount) * BigInt(PPM_PER_WHOLE) > BigInt(base) * BigInt(limitPpm)
}
