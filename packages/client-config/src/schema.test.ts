import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ClientConfigError,
  clientConfigSchema,
  parseClientConfig,
  parseClientConfigJson,
  safeParseClientConfig,
  type ClientConfigInput,
} from './index.js'

const examplesDir = join(import.meta.dirname, '..', 'examples')

function readExample(file: string): ClientConfigInput {
  return JSON.parse(readFileSync(join(examplesDir, file), 'utf8')) as ClientConfigInput
}

/** A fresh copy of the minimal valid config, safe to mutate in a test. */
function validConfig(): ClientConfigInput {
  return readExample('acme-mart.client.config.json')
}

/** Paths (joined with ".") of every issue the schema reports for `input`. */
function issuePaths(input: unknown): string[] {
  const result = clientConfigSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('example configs', () => {
  const files = readdirSync(examplesDir).filter((file) => file.endsWith('.client.config.json'))

  it('has at least two examples', () => {
    expect(files.length).toBeGreaterThanOrEqual(2)
  })

  it.each(files)('%s is valid', (file) => {
    expect(issuePaths(readExample(file))).toEqual([])
  })
})

describe('defaults', () => {
  it('enables payment methods and turns off references unless set', () => {
    const input = validConfig()
    input.paymentMethods = [{ code: 'cash', label: 'Cash', type: 'cash' }]
    const config = parseClientConfig(input)
    expect(config.paymentMethods[0]).toEqual({
      code: 'cash',
      label: 'Cash',
      type: 'cash',
      enabled: true,
      requiresReference: false,
    })
  })
})

describe('schemaVersion', () => {
  it('rejects unknown versions so the POS refuses them', () => {
    expect(issuePaths({ ...validConfig(), schemaVersion: 2 })).toEqual(['schemaVersion'])
  })
})

describe('strict objects', () => {
  it('rejects unknown top-level keys such as secrets', () => {
    expect(issuePaths({ ...validConfig(), databaseUri: 'postgres://x' })).toEqual([''])
  })

  it('rejects unknown nested keys', () => {
    const input = validConfig()
    Object.assign(input.admin, { password: 'secret' })
    expect(issuePaths(input)).toEqual(['admin'])
  })
})

describe('client', () => {
  it.each(['Acme', 'acme_mart', 'acme--mart', '-acme', 'acme-', ''])('rejects slug %j', (slug) => {
    const input = validConfig()
    input.client.slug = slug
    expect(issuePaths(input)).toEqual(['client.slug'])
  })

  it('rejects a blank display name', () => {
    const input = validConfig()
    input.client.displayName = '   '
    expect(issuePaths(input)).toEqual(['client.displayName'])
  })

  it('rejects an invalid email', () => {
    const input = validConfig()
    input.client.email = 'not-an-email'
    expect(issuePaths(input)).toEqual(['client.email'])
  })
})

describe('locale', () => {
  it.each([
    ['currency', 'usd'],
    ['currency', 'XYZ'],
    ['locale', 'not a locale'],
    ['timezone', 'Mars/Olympus'],
    ['dateFormat', 'yyyy/MM/dd'],
  ] as const)('rejects %s %j', (field, value) => {
    const input = validConfig()
    ;(input.locale as Record<string, string>)[field] = value
    expect(issuePaths(input)).toEqual([`locale.${field}`])
  })

  it.each(['UTC', 'Asia/Colombo', 'America/New_York'])('accepts time zone %s', (timezone) => {
    const input = validConfig()
    input.locale.timezone = timezone
    expect(issuePaths(input)).toEqual([])
  })
})

describe('branding', () => {
  it.each(['#FFF', '0F766E', '#0F766G'])('rejects colour %j', (color) => {
    const input = validConfig()
    input.branding.primaryColor = color
    expect(issuePaths(input)).toEqual(['branding.primaryColor'])
  })

  it.each(['/etc/logo.png', 'C:/logo.png', '../logo.png', 'assets/../../logo.png', 'logo.gif'])(
    'rejects logo path %j',
    (logo) => {
      const input = validConfig()
      input.branding.logo = logo
      expect(issuePaths(input)).toEqual(['branding.logo'])
    },
  )

  it('allows the logo to be omitted', () => {
    const input = validConfig()
    delete input.branding.logo
    expect(issuePaths(input)).toEqual([])
  })
})

describe('tax', () => {
  it.each([-1, 100.5, 7.12345])('rejects rate %d', (ratePercent) => {
    const input = validConfig()
    input.tax.rates[0]!.ratePercent = ratePercent
    expect(issuePaths(input)).toEqual(['tax.rates.0.ratePercent'])
  })

  it.each([0, 8.875, 15.5, 100])('accepts rate %d', (ratePercent) => {
    const input = validConfig()
    input.tax.rates[0]!.ratePercent = ratePercent
    expect(issuePaths(input)).toEqual([])
  })

  it('requires at least one rate', () => {
    const input = validConfig()
    input.tax.rates = []
    expect(issuePaths(input)).toContain('tax.rates')
  })

  it('requires the default rate to exist', () => {
    const input = validConfig()
    input.tax.defaultRateCode = 'RED'
    expect(issuePaths(input)).toEqual(['tax.defaultRateCode'])
  })

  it('rejects duplicate rate codes', () => {
    const input = validConfig()
    input.tax.rates.push({ code: 'STD', name: 'Duplicate', ratePercent: 5 })
    expect(issuePaths(input)).toEqual(['tax.rates.1.code'])
  })
})

describe('payment methods', () => {
  it('requires an enabled cash method', () => {
    const input = validConfig()
    input.paymentMethods[0]!.enabled = false
    expect(issuePaths(input)).toEqual(['paymentMethods'])
  })

  it('rejects duplicate codes', () => {
    const input = validConfig()
    input.paymentMethods.push({ code: 'card', label: 'Card 2', type: 'other' })
    expect(issuePaths(input)).toEqual(['paymentMethods.2.code'])
  })

  it('rejects unknown types', () => {
    const input = validConfig()
    ;(input.paymentMethods[1] as { type: string }).type = 'crypto'
    expect(issuePaths(input)).toEqual(['paymentMethods.1.type'])
  })
})

describe('outlets and registers', () => {
  it('requires at least one outlet', () => {
    const input = validConfig()
    input.outlets = []
    expect(issuePaths(input)).toContain('outlets')
  })

  it('requires at least one register per outlet', () => {
    const input = validConfig()
    input.outlets[0]!.registers = []
    expect(issuePaths(input)).toEqual(['outlets.0.registers'])
  })

  it('requires multiOutlet for more than one outlet', () => {
    const input = validConfig()
    input.outlets.push({ code: 'TWO', name: 'Second', registers: [{ code: 'R2', name: 'Till 2' }] })
    expect(issuePaths(input)).toEqual(['outlets'])
    input.modules.multiOutlet = true
    expect(issuePaths(input)).toEqual([])
  })

  it('rejects duplicate outlet codes', () => {
    const input = validConfig()
    input.modules.multiOutlet = true
    input.outlets.push({ code: 'MAIN', name: 'Again', registers: [{ code: 'R2', name: 'Till 2' }] })
    expect(issuePaths(input)).toEqual(['outlets.1.code'])
  })

  it('rejects register codes repeated across outlets', () => {
    const input = validConfig()
    input.modules.multiOutlet = true
    input.outlets.push({ code: 'TWO', name: 'Second', registers: [{ code: 'R1', name: 'Till 1' }] })
    expect(issuePaths(input)).toEqual(['outlets.1.registers.0.code'])
  })
})

describe('receipt', () => {
  it('accepts only 58 or 80 mm paper', () => {
    const input = validConfig()
    ;(input.receipt as { paperWidthMm: number }).paperWidthMm = 72
    expect(issuePaths(input)).toEqual(['receipt.paperWidthMm'])
    input.receipt.paperWidthMm = 58
    expect(issuePaths(input)).toEqual([])
  })
})

describe('parse helpers', () => {
  it('safeParseClientConfig returns a readable error', () => {
    const result = safeParseClientConfig({ ...validConfig(), schemaVersion: 2 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ClientConfigError)
      expect(result.error.message).toContain('schemaVersion')
      expect(result.error.issues).toHaveLength(1)
    }
  })

  it('parseClientConfig throws ClientConfigError', () => {
    expect(() => parseClientConfig({})).toThrow(ClientConfigError)
  })

  it('parseClientConfigJson parses file text', () => {
    const json = readFileSync(join(examplesDir, 'acme-mart.client.config.json'), 'utf8')
    expect(parseClientConfigJson(json).client.slug).toBe('acme-mart')
  })

  it('parseClientConfigJson reports malformed JSON', () => {
    expect(() => parseClientConfigJson('{ nope')).toThrow(/not valid JSON/)
  })
})
