import { PricingError } from './errors.js'
import { type Money } from './rounding.js'

function currencyFormat(currency: string, locale = 'en'): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency })
  } catch {
    throw new PricingError(
      'invalid_currency',
      `Unknown currency "${currency}" or locale "${locale}"`,
    )
  }
}

/** Number of minor-unit digits for an ISO 4217 currency: 2 for USD, 0 for JPY, 3 for KWD. */
export function currencyMinorDigits(currency: string): number {
  // Always set for `style: 'currency'`; ISO 4217 data defines the digits per currency.
  return currencyFormat(currency).resolvedOptions().maximumFractionDigits!
}

/** Formats minor units for display. Use only at the UI edge. */
export function formatMoney(amount: Money, currency: string, locale: string): string {
  const digits = currencyMinorDigits(currency)
  return currencyFormat(currency, locale).format(amount / 10 ** digits)
}

/**
 * Parses a typed amount such as `12`, `12.5` or `12.50` into minor units without floating point.
 * Accepts digits with an optional `.` and at most the currency's minor digits; no signs,
 * separators or symbols.
 */
export function parseMoneyInput(input: string, currency: string): Money {
  const digits = currencyMinorDigits(currency)
  const pattern = digits === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`)
  const match = pattern.exec(input.trim())
  if (!match) {
    throw new PricingError('invalid_money_input', `"${input}" is not a valid ${currency} amount`)
  }
  const fraction = (match[2] ?? '').padEnd(digits, '0')
  const amount = Number(match[1]! + fraction)
  if (!Number.isSafeInteger(amount)) {
    throw new PricingError('invalid_money_input', `"${input}" is too large`)
  }
  return amount
}
