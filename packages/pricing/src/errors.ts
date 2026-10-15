export type PricingErrorCode =
  | 'invalid_amount'
  | 'invalid_quantity'
  | 'invalid_percent'
  | 'discount_exceeds_amount'
  | 'empty_refund'
  | 'unknown_line'
  | 'duplicate_line'
  | 'refund_exceeds_quantity'
  | 'non_cash_overpayment'
  | 'invalid_currency'
  | 'invalid_money_input'

/** Thrown when pricing input is invalid. `code` is stable and safe to branch on. */
export class PricingError extends Error {
  readonly code: PricingErrorCode

  constructor(code: PricingErrorCode, message: string) {
    super(message)
    this.name = 'PricingError'
    this.code = code
  }
}
