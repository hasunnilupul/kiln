import { PricingError } from './errors.js'

/** Parts per million: 100% is 1,000,000 ppm. */
export const PPM_PER_WHOLE = 1_000_000

/** Integer minor units of a currency (e.g. cents). */
export type Money = number

/** Throws unless `value` is a non-negative safe integer amount of minor units. */
export function assertMoney(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PricingError(
      'invalid_amount',
      `${name} must be a non-negative integer of minor units`,
    )
  }
}

/** Throws unless `value` is a positive safe integer quantity. */
export function assertQuantity(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PricingError('invalid_quantity', `${name} must be a positive integer`)
  }
}

/**
 * Converts a percentage with up to 4 decimal places (e.g. 18, 8.875) to integer parts per
 * million so later arithmetic stays in integers.
 */
export function percentToPpm(percent: number, name = 'percent'): number {
  const ppm = Math.round(percent * 10_000)
  if (
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    Math.abs(percent * 10_000 - ppm) > 1e-6
  ) {
    throw new PricingError(
      'invalid_percent',
      `${name} must be between 0 and 100 with at most 4 decimal places`,
    )
  }
  return ppm
}

/** Integer product that throws when the result leaves the safe integer range. */
export function multiplyMoney(amount: Money, quantity: number, name: string): Money {
  const product = amount * quantity
  if (!Number.isSafeInteger(product)) {
    throw new PricingError('invalid_amount', `${name} is too large`)
  }
  return product
}

/**
 * Returns `a × b ÷ c` rounded to the nearest integer, halves away from zero, computed exactly
 * with BigInt. `a`, `b` and `c` must be integers and `c` must be positive.
 */
export function mulDivRound(a: number, b: number, c: number): number {
  const numerator = BigInt(a) * BigInt(b)
  const divisor = BigInt(c)
  let quotient = numerator / divisor
  const remainder = numerator % divisor
  const twiceRemainder = remainder < 0n ? -2n * remainder : 2n * remainder
  if (twiceRemainder >= divisor) {
    quotient += numerator < 0n ? -1n : 1n
  }
  return Number(quotient)
}

/**
 * Splits `total` across `weights` in proportion, so the parts always sum to `total`
 * (largest-remainder method; ties go to the earlier weight). Callers guarantee
 * `0 <= total <= sum(weights)`.
 */
export function allocateProportionally(total: Money, weights: readonly Money[]): Money[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightSum === 0) {
    return weights.map(() => 0)
  }
  const bigTotal = BigInt(total)
  const bigSum = BigInt(weightSum)
  const parts = weights.map((weight, index) => {
    const scaled = bigTotal * BigInt(weight)
    return { index, base: Number(scaled / bigSum), remainder: scaled % bigSum }
  })
  let leftover = total - parts.reduce((sum, part) => sum + part.base, 0)
  const byRemainder = [...parts].sort((x, y) =>
    x.remainder === y.remainder ? x.index - y.index : x.remainder > y.remainder ? -1 : 1,
  )
  const result = parts.map((part) => part.base)
  for (const part of byRemainder) {
    if (leftover === 0) break
    result[part.index]! += 1
    leftover -= 1
  }
  return result
}
