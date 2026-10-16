import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseClientConfig, type ClientConfigInput } from '@kiln/client-config'
import config from '@/payload.config'
import { seedDatabase, uploadSeedLogo } from '@/lib/seed'
import {
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Runs the real first-boot seed (FR-02, FR-03) inside a transaction, checks the result, then rolls
 * it back so the suite can run against a development database.
 */

const run = Date.now().toString(36).toUpperCase()
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const clientConfig: ClientConfigInput = {
  schemaVersion: 1,
  client: {
    id: `cl_${run}`,
    slug: 'seed-test',
    legalName: 'Seed Test Ltd',
    displayName: 'Seed Test',
  },
  locale: { currency: 'LKR', locale: 'en-LK', timezone: 'Asia/Colombo', dateFormat: 'dd/MM/yyyy' },
  branding: {
    primaryColor: '#1E3A8A',
    accentColor: '#E11D48',
    logo: 'assets/logo.png',
    receiptFooter: 'Thanks',
  },
  tax: {
    pricesIncludeTax: false,
    rates: [
      { code: `VAT${run}`, name: 'VAT', ratePercent: 18 },
      { code: `ZERO${run}`, name: 'Zero', ratePercent: 0 },
    ],
    defaultRateCode: `VAT${run}`,
  },
  paymentMethods: [
    { code: `cash-${run}`.toLowerCase(), label: 'Cash', type: 'cash' },
    {
      code: `card-${run}`.toLowerCase(),
      label: 'Card',
      type: 'card_external',
      requiresReference: true,
    },
  ],
  outlets: [
    { code: `FORT${run}`, name: 'Fort', registers: [{ code: `F1${run}`, name: 'Fort 1' }] },
    { code: `KANDY${run}`, name: 'Kandy', registers: [{ code: `K1${run}`, name: 'Kandy 1' }] },
  ],
  modules: { inventory: true, customers: false, discounts: true, multiOutlet: true },
  receipt: { paperWidthMm: 58, showTaxBreakdown: true, showCashierName: false },
  admin: { email: `owner-${run}@seed.test`.toLowerCase(), name: 'Seed Owner' },
}

let payload: Payload
let assetsDir: string
let req: PayloadRequest
const password = 'initial-admin-password'

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  assetsDir = await mkdtemp(path.join(tmpdir(), 'kiln-seed-assets-'))
  await import('node:fs/promises').then((fs) => fs.mkdir(path.join(assetsDir, 'assets')))
  await writeFile(path.join(assetsDir, 'assets', 'logo.png'), Buffer.from(ONE_PIXEL_PNG, 'base64'))

  req = await createLocalReq({}, payload)
  await initTransaction(req)
  const inputs = { config: parseClientConfig(clientConfig), adminPassword: password, assetsDir }
  await seedDatabase(payload, inputs, req)
  // In production the logo is uploaded after the seed commits; here it shares the test transaction.
  await uploadSeedLogo(payload, inputs, req)
})

afterAll(async () => {
  // The logo file is written to storage before the database insert, so remove it explicitly.
  const logo = await payload.find({
    collection: 'media',
    where: { alt: { equals: 'Seed Test logo' } },
    req,
  })
  await killTransaction(req)
  for (const doc of logo.docs) {
    if (doc.filename) await rm(path.resolve('media', doc.filename), { force: true })
  }
  await rm(assetsDir, { recursive: true, force: true })
})

const inTransaction = {
  overrideAccess: true,
  get req() {
    return req
  },
}

describe('seedDatabase', () => {
  it('seeds tax rates, payment methods, outlets and registers', async () => {
    const rates = await payload.find({
      collection: 'tax-rates',
      where: { code: { like: run } },
      sort: 'code',
      ...inTransaction,
    })
    expect(rates.docs.map((r) => [r.code, r.ratePercent])).toEqual([
      [`VAT${run}`, 18],
      [`ZERO${run}`, 0],
    ])

    const methods = await payload.find({
      collection: 'payment-methods',
      where: { code: { like: run.toLowerCase() } },
      sort: 'sortOrder',
      ...inTransaction,
    })
    expect(methods.docs.map((m) => [m.type, m.enabled, m.requiresReference, m.sortOrder])).toEqual([
      ['cash', true, false, 0],
      ['card_external', true, true, 1],
    ])

    const registers = await payload.find({
      collection: 'registers',
      where: { code: { like: run } },
      depth: 1,
      sort: 'code',
      ...inTransaction,
    })
    expect(
      registers.docs.map((r) => [
        r.code,
        typeof r.outlet === 'object' ? r.outlet.code : null,
        r.nextSaleNumber,
      ]),
    ).toEqual([
      [`F1${run}`, `FORT${run}`, 1],
      [`K1${run}`, `KANDY${run}`, 1],
    ])
  })

  it('writes system settings and branding', async () => {
    const settings = await payload.findGlobal({
      slug: 'system-settings',
      depth: 1,
      ...inTransaction,
    })
    expect(settings).toMatchObject({
      displayName: 'Seed Test',
      currency: 'LKR',
      timezone: 'Asia/Colombo',
      pricesIncludeTax: false,
      modules: { inventory: true, customers: false, discounts: true, multiOutlet: true },
      receipt: { paperWidthMm: '58', showTaxBreakdown: true, showCashierName: false },
      clientId: `cl_${run}`,
      configSchemaVersion: 1,
    })
    expect(settings.seededAt).toBeTruthy()
    expect(typeof settings.defaultTaxRate === 'object' && settings.defaultTaxRate?.code).toBe(
      `VAT${run}`,
    )

    const branding = await payload.findGlobal({ slug: 'branding', depth: 1, ...inTransaction })
    expect(branding).toMatchObject({
      primaryColor: '#1E3A8A',
      accentColor: '#E11D48',
      receiptFooter: 'Thanks',
    })
    expect(typeof branding.logo === 'object' && branding.logo?.mimeType).toBe('image/png')
  })

  it('creates the first admin, who must change the password (FR-03)', async () => {
    const users = await payload.find({
      collection: 'users',
      where: { email: { equals: clientConfig.admin.email } },
      ...inTransaction,
    })
    expect(users.docs).toHaveLength(1)
    expect(users.docs[0]).toMatchObject({
      name: 'Seed Owner',
      role: 'admin',
      mustChangePassword: true,
    })
    expect(users.docs[0]!.outlets).toHaveLength(2)

    const login = await payload.login({
      collection: 'users',
      data: { email: clientConfig.admin.email, password },
      req,
    })
    expect(login.token).toBeTruthy()
  })

  it('records the seed in the audit log', async () => {
    const audit = await payload.find({
      collection: 'audit-log',
      where: { action: { equals: 'seed' } },
      sort: '-createdAt',
      limit: 1,
      ...inTransaction,
    })
    expect(audit.docs[0]?.data).toEqual({ clientId: `cl_${run}`, configSchemaVersion: 1 })
  })
})
