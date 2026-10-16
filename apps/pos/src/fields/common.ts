import { percentToPpm } from '@kiln/pricing'
import type { NumberField, RelationshipField, TextField } from 'payload'

/**
 * Money in integer minor units (cents). Never a float (CLAUDE.md: Data and money).
 * Pass `signed` for values such as variances that can be negative.
 */
export function moneyField(
  overrides: Omit<Partial<NumberField>, 'type' | 'hasMany'> & { name: string },
  { signed = false }: { signed?: boolean } = {},
): NumberField {
  return {
    type: 'number',
    ...overrides,
    validate: (value: number | null | undefined, { required }: { required?: boolean }) => {
      if (value === null || value === undefined) {
        return required ? 'This field is required.' : true
      }
      if (!Number.isSafeInteger(value) || (!signed && value < 0)) {
        return signed
          ? 'Enter a whole number of minor units (e.g. cents).'
          : 'Enter a whole, non-negative number of minor units (e.g. cents).'
      }
      return true
    },
    admin: { step: 1, ...overrides.admin },
  } as NumberField
}

/** Whole number such as a quantity or a stock delta. */
export function integerField(
  overrides: Omit<Partial<NumberField>, 'type' | 'hasMany'> & { name: string },
  { min }: { min?: number } = {},
): NumberField {
  return {
    type: 'number',
    ...overrides,
    validate: (value: number | null | undefined, { required }: { required?: boolean }) => {
      if (value === null || value === undefined) {
        return required ? 'This field is required.' : true
      }
      if (!Number.isSafeInteger(value) || (min !== undefined && value < min)) {
        return min === undefined
          ? 'Enter a whole number.'
          : `Enter a whole number of at least ${min}.`
      }
      return true
    },
    admin: { step: 1, ...overrides.admin },
  } as NumberField
}

/** A percentage between 0 and 100 with up to 4 decimal places, as `@kiln/pricing` accepts. */
export function percentField(
  overrides: Omit<Partial<NumberField>, 'type' | 'hasMany'> & { name: string },
): NumberField {
  return {
    type: 'number',
    ...overrides,
    validate: (value: number | null | undefined, { required }: { required?: boolean }) => {
      if (value === null || value === undefined) {
        return required ? 'This field is required.' : true
      }
      try {
        percentToPpm(value)
        return true
      } catch {
        return 'Enter a percentage from 0 to 100 with at most 4 decimal places.'
      }
    },
  } as NumberField
}

/** Unique upper-case code such as `MAIN`, `R1` or `STD`, matching the client config. */
export function codeField(overrides: Partial<TextField> = {}): TextField {
  return {
    name: 'code',
    type: 'text',
    required: true,
    unique: true,
    index: true,
    validate: (value: string | null | undefined) =>
      (typeof value === 'string' && /^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(value)) ||
      'Use 1–32 upper-case letters, digits, "_" or "-".',
    ...overrides,
  } as TextField
}

/** Outlet a document belongs to; drives outlet scoping (FR-11). */
export function outletField(overrides: Partial<RelationshipField> = {}): RelationshipField {
  return {
    name: 'outlet',
    type: 'relationship',
    relationTo: 'outlets',
    required: true,
    index: true,
    ...overrides,
  } as RelationshipField
}
