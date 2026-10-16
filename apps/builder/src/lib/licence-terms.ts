import { randomBytes } from 'node:crypto'

/** The terms a licence can be issued or renewed for (BR-30). */
export const LICENCE_TERMS = {
  trial: { label: 'Trial (1 month)', months: 1 },
  '3m': { label: '3 months', months: 3 },
  '12m': { label: '12 months', months: 12 },
} as const

export type LicenceTerm = keyof typeof LICENCE_TERMS

export const LICENCE_TERM_IDS = Object.keys(LICENCE_TERMS) as LicenceTerm[]

/**
 * `from` plus `months` calendar months in UTC, clamped to the last day of a shorter month
 * (31 January + 1 month = 28 or 29 February).
 */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime())
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

/** When a licence issued at `issuedAt` for `term` expires. */
export function licenceExpiry(issuedAt: Date, term: LicenceTerm): Date {
  return addMonths(issuedAt, LICENCE_TERMS[term].months)
}

/** A new licence id, e.g. `lic_7k2m9q4x8w1p`. */
export function newLicenceId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  return `lic_${Array.from(randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join('')}`
}
