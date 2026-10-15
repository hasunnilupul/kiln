import { randomUUID } from 'node:crypto'

import config from '@/payload.config'
import { adjustStock, finaliseSale } from '@/endpoints/pos/sales'
import { inTransaction } from '@/lib/db'
import { hashPin, resetPinAttempts } from '@/lib/pin'
import { applyStockChange } from '@/lib/stock'
import type {
  Outlet,
  PaymentMethod,
  ProductVariant,
  Register,
  Shift,
  TaxRate,
  User,
} from '@/payload-types'
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

/**
 * Sale finalisation (FR-32, FR-40, FR-41, FR-42) and stock (FR-23, FR-24). Most tests run in a
 * transaction that is rolled back afterwards, so they can set system settings freely.
 */

let payload: Payload
let fx: Fixtures
let outlet: Outlet
let register: Register
let cashier: User
let otherCashier: User
let manager: User
let taxRate: TaxRate
let widget: ProductVariant
let gadget: ProductVariant
let retired: ProductVariant
let cash: PaymentMethod
let card: PaymentMethod
let shift: Shift
let closedShift: Shift
let otherShift: Shift

async function product(name: string, price: number, active = true) {
  const p = await fx.make<{ id: number }>('products', {
    name,
    sku: `${name}-${fx.run}`,
    taxRate: taxRate.id,
    active,
  })
  return fx.make<ProductVariant>('product-variants', {
    product: p.id,
    name,
    sku: `${name}-V-${fx.run}`,
    price,
    barcodes: [{ code: `${name}-${fx.run}-BC` }],
  })
}

function openShiftFor(user: User, reg: Register, status: 'open' | 'closed' = 'open') {
  return fx.make<Shift>('shifts', {
    register: reg.id,
    outlet: outlet.id,
    cashier: user.id,
    status,
    openedAt: new Date().toISOString(),
    openingFloat: 10000,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  fx = new Fixtures(payload)
  outlet = await fx.outlet()
  register = await fx.register(outlet)
  cashier = await fx.user('cashier', [outlet])
  otherCashier = await fx.user('cashier', [outlet])
  manager = await fx.user('manager', [outlet])
  await payload.update({
    collection: 'users',
    id: manager.id,
    data: { pinHash: await hashPin('2468') },
    overrideAccess: true,
  })
  taxRate = await fx.make('tax-rates', { code: `T${fx.run}`, name: 'Std', ratePercent: 18 })
  widget = await product('WIDGET', 1180)
  gadget = await product('GADGET', 500)
  retired = await product('RETIRED', 100, false)
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
  shift = await openShiftFor(cashier, register)
  closedShift = await openShiftFor(cashier, await fx.register(outlet), 'closed')
  otherShift = await openShiftFor(otherCashier, await fx.register(outlet))
})

afterAll(async () => {
  const variants = [widget.id, gadget.id, retired.id]
  await payload.delete({
    collection: 'stock-movements',
    where: { variant: { in: variants } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'stock-levels',
    where: { variant: { in: variants } },
    overrideAccess: true,
  })
  await fx.cleanup()
})

let req: PayloadRequest

async function useSettings(overrides: Record<string, unknown> = {}) {
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
      approvals: { discountLimitPercent: 10 },
      receipt: { paperWidthMm: '80', showTaxBreakdown: true, showCashierName: true },
      ...overrides,
    },
    overrideAccess: true,
    req,
  })
}

beforeEach(async () => {
  resetPinAttempts()
  req = await createLocalReq({}, payload)
  await initTransaction(req)
  await useSettings()
})

afterEach(async () => {
  await killTransaction(req)
})

const sell = (body: Record<string, unknown>, user: User = cashier) =>
  callEndpoint(payload, finaliseSale, {
    req,
    user,
    body: { clientRef: randomUUID(), shiftId: shift.id, ...body },
  })

const stockOf = async (variant: ProductVariant) => {
  const levels = await payload.find({
    collection: 'stock-levels',
    where: { variant: { equals: variant.id }, outlet: { equals: outlet.id } },
    overrideAccess: true,
    req,
  })
  return levels.docs[0]?.quantity ?? 0
}

describe('POST /api/pos/sales/finalise', () => {
  it('records a cash sale with change, snapshots, a sale number and stock (FR-42)', async () => {
    const result = await sell({
      lines: [{ variantId: widget.id, quantity: 2 }],
      payments: [{ paymentMethodId: cash.id, amount: 3000 }],
    })
    expect(result.status).toBe(201)
    const sale = result.body.sale
    expect(sale).toMatchObject({
      number: 1,
      receiptNumber: `${register.code}-000001`,
      cashier: cashier.id,
      outlet: outlet.id,
      pricesIncludeTax: true,
      subtotal: 2360,
      discountTotal: 0,
      taxTotal: 360,
      total: 2360,
      change: 640,
      payments: [{ methodCode: cash.code, methodType: 'cash', amount: 3000 }],
    })
    expect(sale.lines[0]).toMatchObject({
      name: 'WIDGET',
      sku: widget.sku,
      unitPrice: 1180,
      quantity: 2,
      taxRatePercent: 18,
      total: 2360,
    })
    expect(await stockOf(widget)).toBe(-2)
    const movements = await payload.find({
      collection: 'stock-movements',
      where: { reference: { equals: sale.receiptNumber } },
      overrideAccess: true,
      req,
    })
    expect(movements.docs.map((m) => [m.type, m.delta])).toEqual([['sale', -2]])

    const next = await sell({
      lines: [{ variantId: gadget.id, quantity: 1 }],
      payments: [{ paymentMethodId: cash.id, amount: 500 }],
    })
    expect(next.body.sale.number).toBe(2)
  })

  it('ignores prices and totals sent by the till', async () => {
    const result = await sell({
      lines: [{ variantId: widget.id, quantity: 1, unitPrice: 1, total: 1 }],
      total: 1,
      payments: [{ paymentMethodId: cash.id, amount: 1180 }],
    })
    expect(result.body.sale).toMatchObject({ total: 1180, lines: [{ unitPrice: 1180 }] })
  })

  it('splits card and cash, requiring the card reference (FR-40, FR-41)', async () => {
    const lines = [{ variantId: widget.id, quantity: 1 }]
    expect(
      await sell({
        lines,
        payments: [
          { paymentMethodId: card.id, amount: 1000 },
          { paymentMethodId: cash.id, amount: 500 },
        ],
      }),
    ).toMatchObject({ status: 422, body: { error: { code: 'reference_required' } } })

    const result = await sell({
      lines,
      payments: [
        { paymentMethodId: card.id, amount: 1000, reference: 'AUTH123' },
        { paymentMethodId: cash.id, amount: 500 },
      ],
    })
    expect(result.body.sale).toMatchObject({ total: 1180, change: 320 })
  })

  it('refuses underpayment and card overpayment', async () => {
    const lines = [{ variantId: widget.id, quantity: 1 }]
    expect(
      await sell({ lines, payments: [{ paymentMethodId: cash.id, amount: 1000 }] }),
    ).toMatchObject({
      status: 422,
      body: { error: { code: 'payment_incomplete' } },
    })
    expect(
      await sell({ lines, payments: [{ paymentMethodId: card.id, amount: 2000, reference: 'X' }] }),
    ).toMatchObject({ status: 422, body: { error: { code: 'non_cash_overpayment' } } })
  })

  it('needs a manager PIN for discounts above the limit (FR-13)', async () => {
    const within = await sell({
      lines: [{ variantId: widget.id, quantity: 1, discount: { type: 'percent', percent: 10 } }],
      payments: [{ paymentMethodId: cash.id, amount: 1062 }],
    })
    expect(within.body.sale).toMatchObject({ discountTotal: 118, total: 1062 })

    const over = {
      lines: [{ variantId: widget.id, quantity: 1 }],
      cartDiscount: { type: 'amount', amount: 200 },
      payments: [{ paymentMethodId: cash.id, amount: 980 }],
    }
    expect(await sell(over)).toMatchObject({
      status: 403,
      body: { error: { code: 'approval_required' } },
    })
    expect(await sell({ ...over, approval: { managerId: manager.id, pin: '1111' } })).toMatchObject(
      {
        status: 403,
        body: { error: { code: 'approval_denied' } },
      },
    )
    const approved = await sell({ ...over, approval: { managerId: manager.id, pin: '2468' } })
    expect(approved.body.sale).toMatchObject({ total: 980, discountApprovedBy: manager.id })
  })

  it('refuses discounts and customers when their modules are off', async () => {
    await useSettings({
      modules: { inventory: true, customers: false, discounts: false, multiOutlet: true },
    })
    expect(
      await sell({
        lines: [{ variantId: widget.id, quantity: 1, discount: { type: 'amount', amount: 1 } }],
        payments: [{ paymentMethodId: cash.id, amount: 1179 }],
      }),
    ).toMatchObject({ status: 403, body: { error: { code: 'discounts_disabled' } } })
    expect(
      await sell({
        lines: [{ variantId: widget.id, quantity: 1 }],
        customerId: 1,
        payments: [{ paymentMethodId: cash.id, amount: 1180 }],
      }),
    ).toMatchObject({ status: 403, body: { error: { code: 'customers_disabled' } } })
  })

  it('leaves stock alone when inventory is off', async () => {
    await useSettings({
      modules: { inventory: false, customers: true, discounts: true, multiOutlet: true },
    })
    await sell({
      lines: [{ variantId: gadget.id, quantity: 3 }],
      payments: [{ paymentMethodId: cash.id, amount: 1500 }],
    })
    expect(await stockOf(gadget)).toBe(0)
  })

  it('prices tax on top when prices exclude tax', async () => {
    await useSettings({ pricesIncludeTax: false })
    const result = await sell({
      lines: [{ variantId: gadget.id, quantity: 1 }],
      payments: [{ paymentMethodId: cash.id, amount: 590 }],
    })
    expect(result.body.sale).toMatchObject({ pricesIncludeTax: false, taxTotal: 90, total: 590 })
  })

  it('refuses inactive items, closed shifts and other cashiers’ shifts', async () => {
    const payments = [{ paymentMethodId: cash.id, amount: 5000 }]
    expect(await sell({ lines: [{ variantId: retired.id, quantity: 1 }], payments })).toMatchObject(
      {
        status: 409,
        body: { error: { code: 'item_unavailable' } },
      },
    )
    expect(
      await sell({
        shiftId: closedShift.id,
        lines: [{ variantId: widget.id, quantity: 1 }],
        payments,
      }),
    ).toMatchObject({ status: 409, body: { error: { code: 'shift_closed' } } })
    expect(
      await sell({
        shiftId: otherShift.id,
        lines: [{ variantId: widget.id, quantity: 1 }],
        payments,
      }),
    ).toMatchObject({ status: 403, body: { error: { code: 'not_your_shift' } } })
  })

  it('returns the recorded sale when the till retries (idempotent)', async () => {
    const body = {
      clientRef: randomUUID(),
      lines: [{ variantId: widget.id, quantity: 1 }],
      payments: [{ paymentMethodId: cash.id, amount: 1180 }],
    }
    const first = await sell(body)
    const retry = await sell(body)
    expect(retry.body).toMatchObject({ replayed: true, sale: { id: first.body.sale.id } })
    expect(await stockOf(widget)).toBe(-1)
    expect(await sell(body, otherCashier)).toMatchObject({ status: 409 })
  })

  it('validates the request', async () => {
    expect(await sell({ lines: [], payments: [] })).toMatchObject({ status: 400 })
  })
})

describe('POST /api/pos/stock/adjust (FR-24)', () => {
  it('lets managers adjust with a reason; cashiers cannot', async () => {
    const body = {
      variantId: gadget.id,
      outletId: outlet.id,
      delta: 12,
      type: 'initial',
      reason: 'Opening stock',
    }
    expect(await callEndpoint(payload, adjustStock, { req, user: cashier, body })).toMatchObject({
      status: 403,
    })
    expect(await callEndpoint(payload, adjustStock, { req, user: manager, body })).toMatchObject({
      status: 201,
      body: { quantity: 12 },
    })
    expect(
      await callEndpoint(payload, adjustStock, {
        req,
        user: manager,
        body: { ...body, delta: -15, type: 'adjustment', reason: 'Count' },
      }),
    ).toMatchObject({ status: 201, body: { quantity: -3 } })
  })
})

describe('concurrency (committed, not rolled back)', () => {
  it('numbers concurrent sales on one register without gaps or duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        callEndpoint(payload, finaliseSale, {
          user: cashier,
          body: {
            clientRef: randomUUID(),
            shiftId: shift.id,
            lines: [{ variantId: gadget.id, quantity: 1 }],
            payments: [{ paymentMethodId: cash.id, amount: 100000 }],
          },
        }),
      ),
    )
    for (const result of results) {
      expect(result.status).toBe(201)
      fx.track('sales', result.body.sale.id)
    }
    expect(results.map((r) => r.body.sale.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('never loses stock updates from parallel transactions', async () => {
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const own = await createLocalReq({}, payload)
        await inTransaction(own, () =>
          applyStockChange(own, {
            variantId: retired.id,
            outletId: outlet.id,
            delta: -1,
            type: 'adjustment',
            userId: manager.id,
          }),
        )
      }),
    )
    const level = await payload.find({
      collection: 'stock-levels',
      where: { variant: { equals: retired.id }, outlet: { equals: outlet.id } },
      overrideAccess: true,
    })
    expect(level.docs[0]?.quantity).toBe(-10)
  })
})
