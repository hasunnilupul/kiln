import { PricingError } from './errors.js'
import { assertMoney, assertQuantity, mulDivRound, type Money } from './rounding.js'
import { buildTaxBreakdown, type TaxBreakdownEntry } from './tax.js'

/** A line of a completed sale, as snapshotted on the sale, plus what has been refunded so far. */
export interface RefundableLine {
  id: string
  quantity: number
  /** Line total the customer paid, tax included. */
  total: Money
  tax: Money
  taxRatePercent: number
  /** Units already refunded by earlier refunds. */
  refundedQuantity: number
}

export interface RefundLineRequest {
  lineId: string
  quantity: number
}

export interface RefundLine {
  lineId: string
  quantity: number
  total: Money
  tax: Money
  taxRatePercent: number
}

export interface RefundTotals {
  lines: RefundLine[]
  total: Money
  taxTotal: Money
  taxBreakdown: TaxBreakdownEntry[]
}

/**
 * The share of `amount` for units `from` up to `to` (out of `quantity`). Rounding cumulatively
 * means any sequence of partial refunds adds up to exactly `amount` once every unit is refunded.
 */
function shareOf(amount: Money, from: number, to: number, quantity: number): Money {
  return mulDivRound(amount, to, quantity) - mulDivRound(amount, from, quantity)
}

/**
 * Calculates a full or partial refund against a completed sale (FR-50, FR-51). Amounts are
 * pro rata to what the customer actually paid for each line, so discounts are refunded
 * proportionally. Never refunds more units than remain refundable.
 */
export function calculateRefund(
  saleLines: readonly RefundableLine[],
  request: readonly RefundLineRequest[],
): RefundTotals {
  if (request.length === 0) {
    throw new PricingError('empty_refund', 'A refund needs at least one line')
  }
  const byId = new Map(saleLines.map((line) => [line.id, line]))
  const seen = new Set<string>()

  const lines = request.map((requested): RefundLine => {
    const line = byId.get(requested.lineId)
    if (!line) {
      throw new PricingError('unknown_line', `Sale has no line "${requested.lineId}"`)
    }
    if (seen.has(requested.lineId)) {
      throw new PricingError('duplicate_line', `Line "${requested.lineId}" appears more than once`)
    }
    seen.add(requested.lineId)

    const name = `line "${line.id}"`
    assertQuantity(line.quantity, `${name} quantity`)
    assertMoney(line.total, `${name} total`)
    assertMoney(line.tax, `${name} tax`)
    assertQuantity(requested.quantity, `${name} refund quantity`)
    if (
      !Number.isSafeInteger(line.refundedQuantity) ||
      line.refundedQuantity < 0 ||
      line.refundedQuantity + requested.quantity > line.quantity
    ) {
      throw new PricingError(
        'refund_exceeds_quantity',
        `Only ${Math.max(0, line.quantity - line.refundedQuantity)} of ${name} can be refunded`,
      )
    }

    const from = line.refundedQuantity
    const to = from + requested.quantity
    return {
      lineId: line.id,
      quantity: requested.quantity,
      total: shareOf(line.total, from, to, line.quantity),
      tax: shareOf(line.tax, from, to, line.quantity),
      taxRatePercent: line.taxRatePercent,
    }
  })

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.total, 0),
    taxTotal: lines.reduce((sum, line) => sum + line.tax, 0),
    taxBreakdown: buildTaxBreakdown(
      lines.map((line) => ({ ...line, totalExcludingTax: line.total - line.tax })),
    ),
  }
}
