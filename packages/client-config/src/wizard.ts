import {
  CLIENT_CONFIG_SCHEMA_VERSION,
  clientConfigSchema,
  type ClientConfig,
  type ClientConfigInput,
} from './schema.js'

/** The builder's setup wizard steps, in order (BR-11), and the config sections each one edits. */
export const WIZARD_STEPS = [
  { id: 'business', label: 'Business', sections: ['client'] },
  { id: 'locale', label: 'Locale', sections: ['locale'] },
  { id: 'branding', label: 'Branding', sections: ['branding'] },
  { id: 'tax', label: 'Tax', sections: ['tax'] },
  { id: 'payments', label: 'Payment methods', sections: ['paymentMethods'] },
  { id: 'outlets', label: 'Outlets and registers', sections: ['outlets'] },
  { id: 'modules', label: 'Modules', sections: ['modules'] },
  { id: 'receipt', label: 'Receipt', sections: ['receipt'] },
  { id: 'admin', label: 'Admin user', sections: ['admin'] },
  { id: 'review', label: 'Review', sections: [] },
] as const satisfies readonly { id: string; label: string; sections: readonly string[] }[]

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id']

export interface StepIssue {
  step: WizardStepId
  /** Path inside the config, e.g. `['outlets', 0, 'registers', 1, 'code']`. */
  path: (string | number)[]
  message: string
}

export type DraftValidation =
  { valid: true; config: ClientConfig; issues: [] } | { valid: false; issues: StepIssue[] }

function stepFor(path: readonly PropertyKey[]): WizardStepId {
  const section = path[0]
  const step = WIZARD_STEPS.find((candidate) =>
    (candidate.sections as readonly string[]).includes(String(section)),
  )
  return step?.id ?? 'review'
}

/**
 * Validates a wizard draft against the full config schema and assigns each issue to the step
 * that edits it, so every step shows only its own problems. Issues outside any step (e.g. the
 * schema version) belong to the review step.
 */
export function validateDraft(draft: unknown): DraftValidation {
  const result = clientConfigSchema.safeParse(draft)
  if (result.success) return { valid: true, config: result.data, issues: [] }
  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      step: stepFor(issue.path),
      path: issue.path.map((key) => (typeof key === 'number' ? key : String(key))),
      message: issue.message,
    })),
  }
}

/**
 * A starting config for a new client: one outlet with one till, cash payments, one tax rate and
 * common defaults. The admin user is left empty on purpose, so the draft is invalid until the
 * owner fills it in.
 */
export function newClientConfig(client: {
  id: string
  slug: string
  displayName: string
}): ClientConfigInput {
  return {
    schemaVersion: CLIENT_CONFIG_SCHEMA_VERSION,
    client: {
      id: client.id,
      slug: client.slug,
      legalName: client.displayName,
      displayName: client.displayName,
    },
    locale: { currency: 'USD', locale: 'en-US', timezone: 'UTC', dateFormat: 'yyyy-MM-dd' },
    branding: { primaryColor: '#0F766E', accentColor: '#F59E0B' },
    tax: {
      pricesIncludeTax: true,
      rates: [{ code: 'STD', name: 'Standard', ratePercent: 0 }],
      defaultRateCode: 'STD',
    },
    paymentMethods: [
      { code: 'cash', label: 'Cash', type: 'cash', enabled: true, requiresReference: false },
    ],
    outlets: [{ code: 'MAIN', name: 'Main store', registers: [{ code: 'R1', name: 'Till 1' }] }],
    modules: { inventory: true, customers: false, discounts: false, multiOutlet: false },
    receipt: { paperWidthMm: 80, showTaxBreakdown: true, showCashierName: true },
    admin: { email: '', name: '' },
  }
}
