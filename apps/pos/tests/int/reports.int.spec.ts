import { randomUUID } from 'node:crypto'

import config from '@/payload.config'
import { reportsCsv, reportsJson } from '@/endpoints/pos/reports'
import { finaliseSale } from '@/endpoints/pos/sales'
import { zonedDay } from '@/lib/dates'
import type { Outlet, User } from '@/payload-types'
import {
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Fixtures, asUser, callEndpoint } from '../helpers/fixtures'

/** Report endpoints (FR-70 to FR-73): access, outlet scoping and CSV. Each test is rolled back. */

let payload: Payload
let fx: Fixtures
let outlet: Outlet
let otherOutlet: Outlet
let cashier: User
let manager: User
let otherManager: User
let req: PayloadRequest
let today: string

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  fx = new Fixtures(payload)
  outlet = await fx.outlet()
  otherOutlet = await fx.outlet()
  cashier = await fx.user('cashier', [outlet])
  manager = await fx.user('manager', [outlet])
  otherManager = await fx.user('manager', [otherOutlet])
})

afterAll(() => fx.cleanup())

beforeEach(async () => {
  req = await createLocalReq({}, payload)
  await initTransaction(req)
  await payload.updateGlobal({
    slug: 'system-settings',
    data: {
      legalName: 'Test Ltd',
      displayName: 'Test',
      currency: 'USD',
      locale: 'en-US',
      timezone: 'UTC',
      dateFormat: 'yyyy-MM-dd',
      pricesIncludeTax: true,
      modules: { inventory: false, customers: false, discounts: false, multiOutlet: true },
      approvals: { discountLimitPercent: 10 },
      receipt: { paperWidthMm: '80', showTaxBreakdown: true, showCashierName: true },
    },
    overrideAccess: true,
    req,
  })
  today = zonedDay(new Date(), 'UTC')

  const create = <T>(
    collection: Parameters<Payload['create']>[0]['collection'],
    data: Record<string, unknown>,
  ) => payload.create({ collection, data: data as never, overrideAccess: true, req }) as Promise<T>
  const register = await create<{ id: number }>('registers', {
    code: `RP${fx.run}`,
    name: 'Till',
    outlet: outlet.id,
    nextSaleNumber: 1,
  })
  const tax = await create<{ id: number }>('tax-rates', {
    code: `RT${fx.run}`,
    name: 'Std',
    ratePercent: 10,
  })
  const product = await create<{ id: number }>('products', {
    name: 'Thing',
    sku: `RPT${fx.run}`,
    taxRate: tax.id,
  })
  const variant = await create<{ id: number }>('product-variants', {
    product: product.id,
    name: 'Thing',
    sku: `RPV${fx.run}`,
    price: 1100,
  })
  const cash = await create<{ id: number }>('payment-methods', {
    code: `rcash${fx.run}`.toLowerCase(),
    label: 'Cash',
    type: 'cash',
  })
  const shift = await create<{ id: number }>('shifts', {
    register: register.id,
    outlet: outlet.id,
    cashier: cashier.id,
    status: 'open',
    openedAt: new Date().toISOString(),
    openingFloat: 0,
  })
  const sale = await callEndpoint(payload, finaliseSale, {
    req,
    user: cashier,
    body: {
      clientRef: randomUUID(),
      shiftId: shift.id,
      lines: [{ variantId: variant.id, quantity: 2 }],
      payments: [{ paymentMethodId: cash.id, amount: 2200 }],
    },
  })
  expect(sale.status).toBe(201)
})

afterEach(() => killTransaction(req))

const reportAs = async (user: User, extra: Record<string, string> = {}) => {
  req.user = asUser(user)
  const params = new URLSearchParams({
    from: today,
    to: today,
    outletId: String(outlet.id),
    ...extra,
  })
  Object.assign(req, { searchParams: params })
  const response = await reportsJson.handler(req)
  return { status: response.status, body: await response.json() }
}

describe('GET /api/pos/reports', () => {
  it('is for managers and admins only', async () => {
    expect((await reportAs(cashier)).status).toBe(403)
  })

  it('reports the outlet’s sales to its manager', async () => {
    const { status, body } = await reportAs(manager)
    expect(status).toBe(200)
    expect(body.totals).toMatchObject({ salesCount: 1, total: 2200, tax: 200, net: 2200 })
    expect(body.byProduct[0]).toMatchObject({ name: 'Thing', quantity: 2, total: 2200 })
    expect(body.shifts).toHaveLength(1)
  })

  it('refuses another outlet’s manager', async () => {
    expect(await reportAs(otherManager)).toMatchObject({
      status: 403,
      body: { error: { code: 'outlet_forbidden' } },
    })
  })

  it('exports CSV with decimals', async () => {
    req.user = asUser(manager)
    Object.assign(req, {
      searchParams: new URLSearchParams({
        from: today,
        to: today,
        outletId: String(outlet.id),
        section: 'byProduct',
      }),
    })
    const response = await reportsCsv.handler(req)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain(
      `byProduct-${today}-to-${today}.csv`,
    )
    const csv = await response.text()
    expect(csv.split('\r\n')[1]).toMatch(/^RPV.*,Thing,2,22\.00,0,0\.00,22\.00$/)
  })
})
