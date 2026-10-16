import { z } from 'zod'

/** The config schema version this package reads and writes. The POS refuses any other version. */
export const CLIENT_CONFIG_SCHEMA_VERSION = 1

export const MODULE_NAMES = ['inventory', 'customers', 'discounts', 'multiOutlet'] as const
export type ModuleName = (typeof MODULE_NAMES)[number]

export const PAYMENT_METHOD_TYPES = ['cash', 'card_external', 'qr', 'other'] as const
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number]

export const DATE_FORMATS = [
  'yyyy-MM-dd',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'dd.MM.yyyy',
  'dd-MM-yyyy',
] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const RECEIPT_PAPER_WIDTHS_MM = [58, 80] as const

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

function isValidLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1
  } catch {
    return false
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** True when `value` has at most `places` decimal places. */
function hasAtMostDecimalPlaces(value: number, places: number): boolean {
  const scaled = value * 10 ** places
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).optional()

/** Upper-case code such as `STD`, `MAIN` or `R1`. */
const upperCode = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, 'Use 1–32 upper-case letters, digits, "_" or "-"')

/** Lower-case code such as `cash` or `card`. */
const lowerCode = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, 'Use 1–32 lower-case letters, digits, "_" or "-"')

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a six-digit hex colour such as #0F766E')

/** A relative path inside the config's asset folder, e.g. `assets/logo.png`. */
const assetPath = z
  .string()
  .regex(
    /^(?!\/)(?![A-Za-z]:)[\w./-]+\.(png|svg|jpe?g|webp)$/i,
    'Use a relative .png, .svg, .jpg or .webp path',
  )
  .refine((value) => !value.split('/').includes('..'), 'Must not leave the config folder')

const clientSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Use 1–64 letters, digits, "_" or "-"'),
  slug: z
    .string()
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case words separated by "-", e.g. acme-mart'),
  legalName: text(200),
  displayName: text(100),
  address: optionalText(500),
  phone: optionalText(50),
  email: z.email().optional(),
  taxRegistrationNo: optionalText(100),
})

const localeSchema = z.strictObject({
  currency: z
    .string()
    .refine(
      (value) => SUPPORTED_CURRENCIES.has(value),
      'Use an ISO 4217 currency code such as USD',
    ),
  locale: z.string().refine(isValidLocale, 'Use a BCP 47 locale such as en-US'),
  timezone: z.string().refine(isValidTimeZone, 'Use an IANA time zone such as Asia/Colombo'),
  dateFormat: z.enum(DATE_FORMATS),
})

const brandingSchema = z.strictObject({
  primaryColor: hexColor,
  accentColor: hexColor,
  logo: assetPath.optional(),
  receiptHeader: optionalText(500),
  receiptFooter: optionalText(500),
})

const taxRateSchema = z.strictObject({
  code: upperCode,
  name: text(100),
  ratePercent: z
    .number()
    .min(0)
    .max(100)
    .refine((value) => hasAtMostDecimalPlaces(value, 4), 'Use at most 4 decimal places'),
})

const taxSchema = z.strictObject({
  pricesIncludeTax: z.boolean(),
  rates: z.array(taxRateSchema).min(1),
  defaultRateCode: upperCode,
})

const paymentMethodSchema = z.strictObject({
  code: lowerCode,
  label: text(50),
  type: z.enum(PAYMENT_METHOD_TYPES),
  enabled: z.boolean().default(true),
  requiresReference: z.boolean().default(false),
})

const registerSchema = z.strictObject({
  code: upperCode,
  name: text(100),
})

const outletSchema = z.strictObject({
  code: upperCode,
  name: text(100),
  address: optionalText(500),
  registers: z.array(registerSchema).min(1),
})

const modulesSchema = z.strictObject({
  inventory: z.boolean(),
  customers: z.boolean(),
  discounts: z.boolean(),
  multiOutlet: z.boolean(),
})

const receiptSchema = z.strictObject({
  paperWidthMm: z.literal(RECEIPT_PAPER_WIDTHS_MM),
  showTaxBreakdown: z.boolean(),
  showCashierName: z.boolean(),
})

const adminSchema = z.strictObject({
  email: z.email(),
  name: text(100),
})

/** Pushes an issue for every value that appears more than once. */
function checkUnique(
  ctx: z.RefinementCtx,
  values: readonly string[],
  pathFor: (index: number) => (string | number)[],
  label: string,
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: 'custom',
        path: pathFor(index),
        message: `Duplicate ${label} "${value}"`,
      })
    }
    seen.add(value)
  })
}

/**
 * Schema for `client.config.json`. Objects are strict: unknown keys are rejected so typos
 * and stray secrets fail validation instead of being silently ignored.
 */
export const clientConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(CLIENT_CONFIG_SCHEMA_VERSION),
    client: clientSchema,
    locale: localeSchema,
    branding: brandingSchema,
    tax: taxSchema,
    paymentMethods: z.array(paymentMethodSchema).min(1),
    outlets: z.array(outletSchema).min(1),
    modules: modulesSchema,
    receipt: receiptSchema,
    admin: adminSchema,
  })
  .superRefine((config, ctx) => {
    const rateCodes = config.tax.rates.map((rate) => rate.code)
    checkUnique(ctx, rateCodes, (i) => ['tax', 'rates', i, 'code'], 'tax rate code')
    if (!rateCodes.includes(config.tax.defaultRateCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tax', 'defaultRateCode'],
        message: `No tax rate with code "${config.tax.defaultRateCode}"`,
      })
    }

    checkUnique(
      ctx,
      config.paymentMethods.map((method) => method.code),
      (i) => ['paymentMethods', i, 'code'],
      'payment method code',
    )
    if (!config.paymentMethods.some((method) => method.type === 'cash' && method.enabled)) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentMethods'],
        message: 'An enabled payment method of type "cash" is required',
      })
    }

    checkUnique(
      ctx,
      config.outlets.map((outlet) => outlet.code),
      (i) => ['outlets', i, 'code'],
      'outlet code',
    )
    // Register codes are unique across all outlets so receipts and reports can name a till by code alone.
    const registers = config.outlets.flatMap((outlet, o) =>
      outlet.registers.map((register, r) => ({
        code: register.code,
        path: ['outlets', o, 'registers', r, 'code'],
      })),
    )
    checkUnique(
      ctx,
      registers.map((register) => register.code),
      (i) => registers[i]!.path,
      'register code',
    )

    if (!config.modules.multiOutlet && config.outlets.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['outlets'],
        message: 'More than one outlet requires the multiOutlet module',
      })
    }
  })

/** A validated client config, with defaults applied. */
export type ClientConfig = z.output<typeof clientConfigSchema>
/** A client config as written in `client.config.json`, before defaults are applied. */
export type ClientConfigInput = z.input<typeof clientConfigSchema>
export type TaxRateConfig = ClientConfig['tax']['rates'][number]
export type PaymentMethodConfig = ClientConfig['paymentMethods'][number]
export type OutletConfig = ClientConfig['outlets'][number]
export type RegisterConfig = OutletConfig['registers'][number]
export type ModulesConfig = ClientConfig['modules']
