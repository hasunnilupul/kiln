import { describe, expect, it } from 'vitest'

import { WIZARD_STEPS, newClientConfig, validateDraft } from './index.js'

/** BR-11: the setup wizard's steps and per-step validation. */

const client = { id: 'cl_test', slug: 'test-shop', displayName: 'Test Shop' }

describe('WIZARD_STEPS', () => {
  it('follows the order in BR-11 and covers every config section', () => {
    expect(WIZARD_STEPS.map((step) => step.id)).toEqual([
      'business',
      'locale',
      'branding',
      'tax',
      'payments',
      'outlets',
      'modules',
      'receipt',
      'admin',
      'review',
    ])
    const sections = WIZARD_STEPS.flatMap((step) => step.sections as readonly string[])
    expect(new Set(sections)).toEqual(
      new Set(Object.keys(newClientConfig(client)).filter((key) => key !== 'schemaVersion')),
    )
  })
})

describe('newClientConfig', () => {
  it('is valid once the admin user is filled in', () => {
    const draft = newClientConfig(client)
    const missingAdmin = validateDraft(draft)
    expect(missingAdmin.valid).toBe(false)
    expect(missingAdmin.issues.every((issue) => issue.step === 'admin')).toBe(true)

    draft.admin = { email: 'owner@test.example', name: 'Owner' }
    const result = validateDraft(draft)
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.config.client).toMatchObject(client)
  })
})

describe('validateDraft', () => {
  it('assigns each issue to the step that edits it', () => {
    const draft = newClientConfig(client)
    draft.admin = { email: 'owner@test.example', name: 'Owner' }
    draft.locale.currency = 'XXXX'
    draft.outlets[0]!.registers[0]!.code = 'bad code'
    const result = validateDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => [issue.step, issue.path.join('.')])).toEqual([
      ['locale', 'locale.currency'],
      ['outlets', 'outlets.0.registers.0.code'],
    ])
  })

  it('puts cross-field rules on their step and unknown sections on review', () => {
    const draft = newClientConfig(client)
    draft.admin = { email: 'owner@test.example', name: 'Owner' }
    draft.tax.defaultRateCode = 'NONE'
    expect(validateDraft(draft).issues).toEqual([
      expect.objectContaining({ step: 'tax', path: ['tax', 'defaultRateCode'] }),
    ])
    draft.tax.defaultRateCode = 'STD'
    expect(validateDraft({ ...draft, extra: true }).issues).toEqual([
      expect.objectContaining({ step: 'review' }),
    ])
  })
})
