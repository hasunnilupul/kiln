import { PPM_PER_WHOLE, mulDivRound, percentToPpm, type Money } from './rounding.js'

export interface LineTax {
  /** Tax on the amount, rounded to the minor unit. */
  tax: Money
  /** Amount the customer pays, tax included. */
  total: Money
  /** Amount before tax. */
  totalExcludingTax: Money
}

/**
 * Tax for one line. With `pricesIncludeTax` the tax is extracted from `amount`
 * (`amount × r ÷ (1 + r)`); otherwise it is added on top (`amount × r`). Tax is rounded per line,
 * halves away from zero.
 */
export function calculateLineTax(
  amount: Money,
  taxRatePercent: number,
  pricesIncludeTax: boolean,
): LineTax {
  const ratePpm = percentToPpm(taxRatePercent, 'taxRatePercent')
  if (pricesIncludeTax) {
    const tax = mulDivRound(amount, ratePpm, PPM_PER_WHOLE + ratePpm)
    return { tax, total: amount, totalExcludingTax: amount - tax }
  }
  const tax = mulDivRound(amount, ratePpm, PPM_PER_WHOLE)
  return { tax, total: amount + tax, totalExcludingTax: amount }
}

export interface TaxBreakdownEntry {
  taxRatePercent: number
  /** Sum of line amounts before tax at this rate. */
  taxableAmount: Money
  tax: Money
}

/** Groups taxed lines by rate, ordered by ascending rate. Entries for 0% rates are kept. */
export function buildTaxBreakdown(
  lines: readonly { taxRatePercent: number; totalExcludingTax: Money; tax: Money }[],
): TaxBreakdownEntry[] {
  const byRate = new Map<number, TaxBreakdownEntry>()
  for (const line of lines) {
    const ratePpm = percentToPpm(line.taxRatePercent, 'taxRatePercent')
    const entry = byRate.get(ratePpm) ?? {
      taxRatePercent: ratePpm / 10_000,
      taxableAmount: 0,
      tax: 0,
    }
    entry.taxableAmount += line.totalExcludingTax
    entry.tax += line.tax
    byRate.set(ratePpm, entry)
  }
  return [...byRate.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry)
}
