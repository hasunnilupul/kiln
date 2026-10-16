import {
  calculateCart,
  discountExceedsLimit,
  settlePayments,
  type CartTotals,
  type Discount,
} from '@kiln/pricing'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { hasRole } from '../../access/roles'
import { approvalSchema, verifyManagerApproval } from '../../lib/approvals'
import { execute, inTransaction, lockRow, sql } from '../../lib/db'
import { activeModules, loadSettings } from '../../lib/settings'
import { applyStockChange } from '../../lib/stock'
import type { PaymentMethod, Product, ProductVariant, Sale, TaxRate } from '../../payload-types'
import {
  MANAGERS,
  PosError,
  STAFF,
  assertOutletAccess,
  id,
  money,
  posEndpoint,
  relId,
  requireUser,
} from './http'

const discountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('amount'), amount: money }),
  z.object({ type: z.literal('percent'), percent: z.number().min(0).max(100) }),
])

/**
 * What the till sends. Only identities, quantities, discounts and tenders: prices, tax and totals
 * are always computed here; anything else the till might send is ignored (CLAUDE.md: Sales
 * integrity).
 */
export const finaliseSaleBody = z.object({
  clientRef: z.string().uuid(),
  shiftId: id,
  lines: z
    .array(
      z.object({
        variantId: id,
        quantity: z.number().int().positive().max(100000),
        discount: discountSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
  cartDiscount: discountSchema.optional(),
  customerId: id.optional(),
  payments: z
    .array(
      z.object({
        paymentMethodId: id,
        amount: money.positive(),
        reference: z.string().trim().max(100).optional(),
      }),
    )
    .max(20),
  approval: approvalSchema.optional(),
})
type FinaliseSaleBody = z.infer<typeof finaliseSaleBody>

const local = (req: PayloadRequest) => ({ overrideAccess: true, req }) as const

type PricedVariant = ProductVariant & { product: Product & { taxRate: TaxRate } }

/** Loads the variants on the cart with their products and tax rates; all must be sellable. */
async function loadVariants(
  req: PayloadRequest,
  ids: number[],
): Promise<Map<number, PricedVariant>> {
  const found = await req.payload.find({
    collection: 'product-variants',
    where: { id: { in: [...new Set(ids)] } },
    depth: 2,
    pagination: false,
    ...local(req),
  })
  const variants = new Map(found.docs.map((v) => [v.id, v as PricedVariant]))
  for (const variantId of ids) {
    const variant = variants.get(variantId)
    const product = variant?.product
    if (
      !variant?.active ||
      typeof product !== 'object' ||
      !product.active ||
      typeof product.taxRate !== 'object' ||
      !product.taxRate.active
    ) {
      throw new PosError(409, 'item_unavailable', `Item ${variantId} cannot be sold`)
    }
  }
  return variants
}

/** Loads the tendered payment methods; all must be enabled and have a reference where required. */
async function loadPayments(req: PayloadRequest, payments: FinaliseSaleBody['payments']) {
  const found = await req.payload.find({
    collection: 'payment-methods',
    where: { id: { in: payments.map((p) => p.paymentMethodId) } },
    depth: 0,
    pagination: false,
    ...local(req),
  })
  const methods = new Map(found.docs.map((m) => [m.id, m]))
  return payments.map((payment) => {
    const method = methods.get(payment.paymentMethodId) as PaymentMethod | undefined
    if (!method?.enabled) {
      throw new PosError(409, 'payment_method_unavailable', 'This payment method is not available')
    }
    if (method.requiresReference && !payment.reference) {
      throw new PosError(422, 'reference_required', `${method.label} needs a reference (FR-41)`)
    }
    return { ...payment, method }
  })
}

/** Discounts beyond the configured limit need a manager PIN (FR-13). */
function needsDiscountApproval(cart: CartTotals, limitPercent: number): boolean {
  const lineOver = cart.lines.some((line) =>
    discountExceedsLimit(line.lineDiscount, line.gross, limitPercent),
  )
  const cartDiscount = cart.lines.reduce((sum, line) => sum + line.cartDiscount, 0)
  const cartBase = cart.lines.reduce((sum, line) => sum + line.gross - line.lineDiscount, 0)
  return lineOver || discountExceedsLimit(cartDiscount, cartBase, limitPercent)
}

/** Takes the register's next sale number atomically (FR-42); concurrent sales never share one. */
async function takeSaleNumber(req: PayloadRequest, registerId: number): Promise<number> {
  const [row] = await execute<{ number: string }>(
    req,
    sql`update registers set next_sale_number = next_sale_number + 1
        where id = ${registerId} returning next_sale_number - 1 as number`,
  )
  return Number(row!.number)
}

/**
 * `POST /api/pos/sales/finalise`: completes a sale in one transaction (FR-32, FR-40, FR-41, FR-42):
 * validate, price on the server, check approvals and payments, number the sale, write it with
 * snapshot lines, and move stock. Retrying with the same `clientRef` returns the recorded sale.
 */
export const finaliseSale = posEndpoint({
  method: 'post',
  path: '/sales/finalise',
  status: 201,
  body: finaliseSaleBody,
  handler: async (req, body) => {
    const user = await requireUser(req, STAFF)
    return inTransaction(req, async () => {
      // Locking the shift serialises this register's sales and keeps the shift from closing mid-sale.
      if (!(await lockRow(req, 'shifts', body.shiftId))) {
        throw new PosError(404, 'shift_not_found', 'Shift not found')
      }

      const replay = await req.payload.find({
        collection: 'sales',
        where: { clientRef: { equals: body.clientRef } },
        limit: 1,
        depth: 0,
        ...local(req),
      })
      if (replay.docs[0]) {
        if (relId(replay.docs[0].cashier as number) !== user.id) {
          throw new PosError(409, 'duplicate_client_ref', 'This sale reference is already used')
        }
        return { sale: replay.docs[0], replayed: true }
      }

      const shift = await req.payload.findByID({
        collection: 'shifts',
        id: body.shiftId,
        depth: 1,
        ...local(req),
      })
      const outletId = relId(shift.outlet as number)!
      const register = shift.register
      if (typeof register !== 'object') throw new Error('Shift register not loaded')
      assertOutletAccess(user, outletId)
      if (shift.status !== 'open') {
        throw new PosError(409, 'shift_closed', 'Open a shift before selling (FR-60)')
      }
      if (relId(shift.cashier as number) !== user.id && !hasRole(user, ...MANAGERS)) {
        throw new PosError(403, 'not_your_shift', 'Sell on your own shift')
      }

      const settings = await loadSettings(req)
      const modules = activeModules(settings)
      const hasDiscount = Boolean(body.cartDiscount) || body.lines.some((line) => line.discount)
      if (hasDiscount && !modules.discounts) {
        throw new PosError(403, 'discounts_disabled', 'Discounts are not enabled')
      }
      if (body.customerId !== undefined && !modules.customers) {
        throw new PosError(403, 'customers_disabled', 'Customers are not enabled')
      }

      const variants = await loadVariants(
        req,
        body.lines.map((line) => line.variantId),
      )
      const cart = calculateCart({
        pricesIncludeTax: Boolean(settings.pricesIncludeTax),
        lines: body.lines.map((line) => {
          const variant = variants.get(line.variantId)!
          return {
            unitPrice: variant.price,
            quantity: line.quantity,
            taxRatePercent: variant.product.taxRate.ratePercent,
            discount: line.discount as Discount | undefined,
          }
        }),
        cartDiscount: body.cartDiscount as Discount | undefined,
      })

      let discountApprovedBy: number | undefined
      if (needsDiscountApproval(cart, settings.approvals?.discountLimitPercent ?? 0)) {
        const approver = await verifyManagerApproval(req, user, body.approval, {
          outletId,
          action: 'discount',
          details: { clientRef: body.clientRef, discountTotal: cart.discountTotal },
        })
        discountApprovedBy = approver.id
      }

      const payments = await loadPayments(req, body.payments)
      const settlement = settlePayments(
        cart.total,
        payments.map((p) => ({ amount: p.amount, isCash: p.method.type === 'cash' })),
      )
      if (!settlement.isSettled) {
        throw new PosError(422, 'payment_incomplete', `${settlement.remaining} still to pay`)
      }

      if (body.customerId !== undefined) {
        await req.payload
          .findByID({ collection: 'customers', id: body.customerId, depth: 0, ...local(req) })
          .catch(() => {
            throw new PosError(404, 'customer_not_found', 'Customer not found')
          })
      }

      const number = await takeSaleNumber(req, register.id)
      const receiptNumber = `${register.code}-${String(number).padStart(6, '0')}`
      const sale: Sale = await req.payload.create({
        collection: 'sales',
        data: {
          clientRef: body.clientRef,
          receiptNumber,
          number,
          register: register.id,
          outlet: outletId,
          shift: shift.id,
          cashier: user.id,
          customer: body.customerId,
          discountApprovedBy,
          status: 'completed',
          completedAt: new Date().toISOString(),
          pricesIncludeTax: Boolean(settings.pricesIncludeTax),
          lines: cart.lines.map((line, index) => {
            const variant = variants.get(body.lines[index]!.variantId)!
            return {
              variant: variant.id,
              // Snapshots, so later catalogue edits never change a completed sale.
              name: variant.name,
              sku: variant.sku,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              taxRatePercent: line.taxRatePercent,
              gross: line.gross,
              lineDiscount: line.lineDiscount,
              cartDiscount: line.cartDiscount,
              tax: line.tax,
              total: line.total,
            }
          }),
          subtotal: cart.subtotal,
          discountTotal: cart.discountTotal,
          taxTotal: cart.taxTotal,
          total: cart.total,
          payments: payments.map((p) => ({
            paymentMethod: p.method.id,
            methodCode: p.method.code,
            methodLabel: p.method.label,
            methodType: p.method.type,
            amount: p.amount,
            reference: p.reference,
          })),
          change: settlement.change,
        },
        depth: 0,
        ...local(req),
      })

      if (modules.inventory) {
        for (const line of sale.lines) {
          await applyStockChange(req, {
            variantId: relId(line.variant as number)!,
            outletId,
            delta: -line.quantity,
            type: 'sale',
            userId: user.id,
            reference: receiptNumber,
          })
        }
      }

      return { sale, replayed: false }
    })
  },
})

/** `POST /api/pos/stock/adjust`: managers correct or set initial stock with a reason (FR-23, FR-24). */
export const adjustStock = posEndpoint({
  method: 'post',
  path: '/stock/adjust',
  status: 201,
  body: z.object({
    variantId: id,
    outletId: id,
    delta: z
      .number()
      .int()
      .refine((value) => value !== 0, 'Must not be zero'),
    type: z.enum(['initial', 'adjustment']).default('adjustment'),
    reason: z.string().trim().min(1).max(200),
  }),
  handler: async (req, body) => {
    const user = await requireUser(req, MANAGERS)
    assertOutletAccess(user, body.outletId)
    return inTransaction(req, async () => {
      await req.payload
        .findByID({ collection: 'product-variants', id: body.variantId, depth: 0, ...local(req) })
        .catch(() => {
          throw new PosError(404, 'item_not_found', 'Item not found')
        })
      await req.payload
        .findByID({ collection: 'outlets', id: body.outletId, depth: 0, ...local(req) })
        .catch(() => {
          throw new PosError(404, 'outlet_not_found', 'Outlet not found')
        })
      const quantity = await applyStockChange(req, {
        variantId: body.variantId,
        outletId: body.outletId,
        delta: body.delta,
        type: body.type,
        userId: user.id,
        reason: body.reason,
      })
      return { variantId: body.variantId, outletId: body.outletId, quantity }
    })
  },
})

export const saleEndpoints = [finaliseSale, adjustStock]
