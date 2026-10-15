import { currencyMinorDigits, formatMoney, parseMoneyInput } from '@kiln/pricing'

export interface Money {
  /** Minor units to display text in the client's currency and locale. */
  format: (minor: number) => string
  /** Typed text to minor units, or null when it is not a valid amount. */
  parse: (text: string) => number | null
  /** Minor units as plain input text, e.g. 1250 → "12.50". */
  toInput: (minor: number) => string
}

/** Money helpers for the client's currency; amounts stay integers until displayed. */
export function makeMoney(currency: string, locale: string): Money {
  const digits = currencyMinorDigits(currency)
  return {
    format: (minor) => formatMoney(minor, currency, locale),
    parse: (text) => {
      try {
        return parseMoneyInput(text, currency)
      } catch {
        return null
      }
    },
    toInput: (minor) => {
      if (digits === 0) return String(minor)
      const whole = Math.floor(minor / 10 ** digits)
      const fraction = String(minor % 10 ** digits).padStart(digits, '0')
      return `${whole}.${fraction}`
    },
  }
}
