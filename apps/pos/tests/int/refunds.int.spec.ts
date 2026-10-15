import { randomUUID } from 'node:crypto'

import config from '@/payload.config'
import { createRefund, previewRefund, refundableLines } from '@/endpoints/pos/refunds'
import { finaliseSale } from '@/endpoints/pos/sales'
import { shiftSummary } from '@/endpoints/pos/shifts'
import { hashPin, resetPinAttempts } from '@/lib/pin'
import type { Outlet, PaymentMethod, ProductVariant, Register, Shift, User } from '@/payload-types'
import {
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Fixtures, callEndpoint } from '../helpers/fixtures'

/** Refunds (FR-13, FR-50, FR-51, FR-52); each test is rolled back. */

let payload: Payload
let fx: Fixtures
let outlet: Outlet
let otherOutlet: Outlet
let cashier: User
let manager: User
let widget: ProductVariant
let cash: PaymentMethod
let card: PaymentMethod
let shift: Shift
let foreignShift: Shift
let req: PayloadRequest

const approval = () => ({ managerId: manager.id, pin: '2468' })

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  fx = new Fixtures(payload)
  outlet = await fx.outlet()
  otherOutlet = await fx.outlet()
  const register: Register = await fx.register(outlet)
  cashier = await fx.user('cashier', [outlet, otherOutlet])
  manager = await fx.user('manager', [outlet])
  await payload.update({
    collection: 'users',
    id: manager.id,
    data: { pinHash: await hashPin('2468') },
    overrideAccess: true,
  })
  const taxRate = await fx.make<{ id: number }>('tax-rates', {
    code: `T${fx.run}`,
    name: 'Std',
    ratePercent: 18,
  })
  const product = await fx.make<{ id: number }>('products', {
    name: 'Widget',
    sku: `W-${fx.run}`,
    taxRate: taxRate.id,
  })
  widget = await fx.make('product-variants', {
    product: product.id,
    name: 'Widget',
    sku: `WV-${fx.run}`,
    price: 1000,
  })
  cash = await fx.make('payment-methods', {
    code: `cash-${fx.run}`.toLowerCase(),
    label: 'Cash',
    type: 'cash',
  })
  card = await fx.make('payment-methods', {
    code: `card-${fx.run}`.toLowerCase(),
    label: 'Card',
    type: 'card_external',
    requiresReference: true,
  })
  const shiftData = {
    cashier: cashier.id,
    status: 'open',
    openedAt: new Date().toISOString(),
    openingFloat: 10000,
  }
  shift = await fx.make('shifts', { ...shiftData, register: register.id, outlet: outlet.id })
  foreignShift = await fx.make('shifts', {
    ...shiftData,
    cashier: manager.id,
    register: (await fx.register(otherOutlet)).id,
    outlet: otherOutlet.id,
  })
})

afterAll(() => fx.cleanup())

beforeEach(async () => {
  resetPinAttempts()
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
      modules: { inventory: true, customers: true, discounts: true, multiOutlet: true },
      approvals: { discountLimitPercent: 100 },
      receipt: { paperWidthMm: '80', showTaxBreakdown: true, showCashierName: true },
    },
    overrideAccess: true,
    req,
  })
})

afterEach(() => killTransaction(req))

/** Sells 3 widgets with a 1 off cart discount (total 2999), paid in cash. */
async function sale() {
  const result = await callEndpoint(payload, finaliseSale, {
    req,
    user: cashier,
    body: {
      clientRef: randomUUID(),
      shiftId: shift.id,
      lines: [{ variantId: widget.id, quantity: 3 }],
      cartDiscount: { type: 'amount', amount: 1 },
      payments: [{ paymentMethodId: cash.id, amount: 2999 }],
    },
  })
  expect(result.status).toBe(201)
  return result.body.sale
}

const refund = (body: Record<string, unknown>) =>
  callEndpoint(payload, createRefund, {
    req,
    user: cashier,
    body: { shiftId: shift.id, reason: 'Faulty', ...body },
  })

const stock = async () => {
  const level = await payload.find({
    collection: 'stock-levels',
    where: { variant: { equals: widget.id }, outlet: { equals: outlet.id } },
    overrideAccess: true,
    req,
  })
  return level.docs[0]?.quantity
}

describe('POST /api/pos/refunds', () => {
  it('needs a manager PIN (FR-13)', async () => {
    const s = await sale()
    const body = {
      saleId: s.id,
      lines: [{ saleLineId: s.lines[0].id, quantity: 1 }],
      payouts: [{ paymentMethodId: cash.id, amount: 1000 }],
    }
    expect(await refund(body)).toMatchObject({
      status: 403,
      body: { error: { code: 'approval_required' } },
    })
  })

  it('refunds pro rata, restocks and never changes the sale (FR-51, FR-52)', async () => {
    const s = await sale()
    expect(await stock()).toBe(-3)
    const result = await refund({
      saleId: s.id,
      lines: [{ saleLineId: s.lines[0].id, quantity: 1 }],
      payouts: [{ paymentMethodId: cash.id, amount: 1000 }],
      approval: approval(),
    })
    expect(result).toMatchObject({
      status: 201,
      body: {
        refund: {
          total: 1000,
          approvedBy: manager.id,
          processedBy: cashier.id,
          lines: [{ quantity: 1, total: 1000, restock: true, name: 'Widget' }],
        },
      },
    })
    expect(await stock()).toBe(-2)

    const unchanged = await payload.findByID({
      collection: 'sales',
      id: s.id,
      overrideAccess: true,
      req,
    })
    expect(unchanged).toMatchObject({ total: 2999, lines: [{ quantity: 3 }] })
  })

  it('adds up exactly over partial refunds and stops at the quantity sold (FR-50)', async () => {
    const s = await sale()
    const line = s.lines[0].id
    const totals: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const lines = [{ saleLineId: line, quantity: 1, restock: false }]
      // The till asks for the exact amount first, then pays out exactly that.
      const preview = await callEndpoint(payload, previewRefund, {
        req,
        user: cashier,
        body: { saleId: s.id, lines },
      })
      const amount = preview.body.refund.total
      const result = await refund({
        saleId: s.id,
        lines,
        payouts: [{ paymentMethodId: cash.id, amount }],
        approval: approval(),
      })
      expect(result.status).toBe(201)
      totals.push(result.body.refund.total)
    }
    // Cumulative rounding: 2999 over three units refunds as 1000, 999, 1000.
    expect(totals).toEqual([1000, 999, 1000])
    expect(await stock()).toBe(-3)

    const refundable = await callEndpoint(payload, refundableLines, {
      req,
      user: cashier,
      params: { id: s.id },
    })
    expect(refundable.body.lines[0]).toMatchObject({
      quantity: 3,
      refundedQuantity: 3,
      refundableQuantity: 0,
    })

    expect(
      await refund({
        saleId: s.id,
        lines: [{ saleLineId: line, quantity: 1 }],
        payouts: [{ paymentMethodId: cash.id, amount: 1 }],
        approval: approval(),
      }),
    ).toMatchObject({ status: 422, body: { error: { code: 'refund_exceeds_quantity' } } })
  })

  it('requires payouts to match the refund and card references', async () => {
    const s = await sale()
    const lines = [{ saleLineId: s.lines[0].id, quantity: 1 }]
    expect(
      await refund({
        saleId: s.id,
        lines,
        payouts: [{ paymentMethodId: cash.id, amount: 999 }],
        approval: approval(),
      }),
    ).toMatchObject({ status: 422, body: { error: { code: 'payout_mismatch' } } })
    expect(
      await refund({
        saleId: s.id,
        lines,
        payouts: [{ paymentMethodId: card.id, amount: 1000 }],
        approval: approval(),
      }),
    ).toMatchObject({ status: 422, body: { error: { code: 'reference_required' } } })
  })

  it('refunds only at the outlet of the sale', async () => {
    const s = await sale()
    expect(
      await refund({
        saleId: s.id,
        shiftId: foreignShift.id,
        lines: [{ saleLineId: s.lines[0].id, quantity: 1 }],
        payouts: [{ paymentMethodId: cash.id, amount: 1000 }],
        approval: approval(),
      }),
    ).toMatchObject({ status: 409, body: { error: { code: 'wrong_outlet' } } })
  })

  it('takes cash refunds out of the shift’s expected cash (FR-61)', async () => {
    const s = await sale()
    await refund({
      saleId: s.id,
      lines: [{ saleLineId: s.lines[0].id, quantity: 1 }],
      payouts: [{ paymentMethodId: cash.id, amount: 1000 }],
      approval: approval(),
    })
    const summary = await callEndpoint(payload, shiftSummary, {
      req,
      user: cashier,
      params: { id: shift.id },
    })
    expect(summary.body.summary).toMatchObject({
      salesTotal: 2999,
      refundsTotal: 1000,
      expectedCash: 11999,
    })
  })
})
