import { describe, expect, it } from 'vitest'

import { PricingError } from './errors.js'
import { currencyMinorDigits, formatMoney, parseMoneyInput } from './money.js'

describe('currencyMinorDigits', () => {
  it.each([
    ['USD', 2],
    ['LKR', 2],
    ['JPY', 0],
    ['KWD', 3],
  ])('%s has %d minor digits', (currency, digits) => {
    expect(currencyMinorDigits(currency)).toBe(digits)
  })

  it('rejects unknown currencies', () => {
    expect(() => currencyMinorDigits('DOLLARS')).toThrow(PricingError)
  })
})

describe('formatMoney', () => {
  it('formats minor units in the client locale', () => {
    expect(formatMoney(123456, 'USD', 'en-US')).toBe('$1,234.56')
    expect(formatMoney(1234, 'JPY', 'en-US')).toBe('¥1,234')
    expect(formatMoney(1234, 'KWD', 'en-US')).toMatch(/^KWD\s1\.234$/)
  })

  it('rejects an invalid locale', () => {
    expect(() => formatMoney(100, 'USD', 'not a locale')).toThrow(
      expect.objectContaining({ code: 'invalid_currency' }),
    )
  })
})

describe('parseMoneyInput', () => {
  it.each([
    ['12', 'USD', 1200],
    ['12.5', 'USD', 1250],
    ['12.50', 'USD', 1250],
    [' 3.07 ', 'USD', 307],
    ['0.01', 'USD', 1],
    ['500', 'JPY', 500],
    ['1.234', 'KWD', 1234],
  ])('parses %j %s as %d', (input, currency, expected) => {
    expect(parseMoneyInput(input, currency)).toBe(expected)
  })

  it.each([
    ['12.505', 'USD'],
    ['5.0', 'JPY'],
    ['-1', 'USD'],
    ['1,000', 'USD'],
    ['$5', 'USD'],
    ['', 'USD'],
    ['12.', 'USD'],
    ['99999999999999999', 'USD'],
  ])('rejects %j %s', (input, currency) => {
    expect(() => parseMoneyInput(input, currency)).toThrow(
      expect.objectContaining({ code: 'invalid_money_input' }),
    )
  })
})
