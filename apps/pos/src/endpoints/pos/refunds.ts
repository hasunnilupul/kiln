import { calculateRefund } from '@kiln/pricing'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { hasRole } from '../../access/roles'
import { approvalSchema, verifyManagerApproval } from '../../lib/approvals'
import { inTransaction, lockRow } from '../../lib/db'
import { activeModules, loadSettings } from '../../lib/settings'
import { applyStockChange } from '../../lib/stock'
import type { PaymentMethod, Sale } from '../../payload-types'
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
  routeId,
  type StaffUser,
} from './http'

const local = (req: PayloadRequest) => ({ overrideAccess: true, req, depth: 0 }) as const

/** Units already refunded per sale line. */
async function refundedQuantities(
  req: PayloadRequest,
  saleId: number,
): Promise<Map<string, number>> {
  const refunds = await req.payload.find({
    collection: 'refunds',
    where: { sale: { equals: saleId } },
    pagination: false,
    ...local(req),
  })
  const refunded = new Map<string, number>()
  for (const refund of refunds.docs) {
    for (const line of refund.lines) {
      refunded.set(line.saleLineId, (refunded.get(line.saleLineId) ?? 0) + line.quantity)
    }
  }
  return refunded
}

/** Loads a sale the user may see (FR-11). */
async function loadSale(req: PayloadRequest, user: StaffUser, saleId: number): Promise<Sale> {
  const sale = await req.payload
    .findByID({ collection: 'sales', id: saleId, ...local(req) })
    .catch(() => null)
  if (!sale) throw new PosError(404, 'sale_not_found', 'Sale not found')
  assertOutletAccess(user, relId(sale.outlet as number)!)
  return sale
}

/**
 * `GET /api/pos/sales/:id/refundable`: a sale's lines with what can still be refunded, for the
 * refund screen (FR-50).
 */
export const refundableLines = posEndpoint({
  method: 'get',
  path: '/sales/:id/refundable',
  handler: async (req) => {
    const user = await requireUser(req, STAFF)
    const sale = await loadSale(req, user, routeId(req))
    const refunded = await refundedQuantities(req, sale.id)
    return {
      sale: {
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        completedAt: sale.completedAt,
        total: sale.total,
      },
      lines: sale.lines.map((line) => ({
        saleLineId: line.id,
        name: line.name,
        sku: line.sku,
        quantity: line.quantity,
        refundedQuantity: refunded.get(line.id!) ?? 0,
        refundableQuantity: line.quantity - (refunded.get(line.id!) ?? 0),
        total: line.total,
      })),
    }
  },
})

const refundLines = z
  .array(
    z.object({
      saleLineId: z.string().min(1),
      quantity: z.number().int().positive(),
      restock: z.boolean().default(true),
    }),
  )
  .min(1)

/** Prices a refund of `lines` against what remains refundable on `sale`. */
async function priceRefund(req: PayloadRequest, sale: Sale, lines: z.infer<typeof refundLines>) {
  const refunded = await refundedQuantities(req, sale.id)
  return calculateRefund(
    sale.lines.map((line) => ({
      id: line.id!,
      quantity: line.quantity,
      total: line.total,
      tax: line.tax,
      taxRatePercent: line.taxRatePercent,
      refundedQuantity: refunded.get(line.id!) ?? 0,
    })),
    lines.map((line) => ({ lineId: line.saleLineId, quantity: line.quantity })),
  )
}

/**
 * `POST /api/pos/refunds/preview`: the server-computed amounts for a refund, so the till can
 * collect exactly that payout. Writes nothing and needs no approval.
 */
export const previewRefund = posEndpoint({
  method: 'post',
  path: '/refunds/preview',
  body: z.object({ saleId: id, lines: refundLines }),
  handler: async (req, body) => {
    const user = await requireUser(req, STAFF)
    const sale = await loadSale(req, user, body.saleId)
    return { refund: await priceRefund(req, sale, body.lines) }
  },
})

export const refundBody = z.object({
  saleId: id,
  /** The open shift the payout comes from. */
  shiftId: id,
  lines: refundLines,
  payouts: z
    .array(
      z.object({
        paymentMethodId: id,
        amount: money.positive(),
        reference: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(10),
  reason: z.string().trim().min(1).max(200),
  approval: approvalSchema.optional(),
})

/**
 * `POST /api/pos/refunds`: refunds all or part of a completed sale in one transaction, with
 * manager approval (FR-13, FR-50, FR-51). Amounts are pro rata to what was paid, quantities never
 * exceed what remains refundable, and restocked lines go back into stock. The sale itself is
 * never changed (FR-52).
 */
export const createRefund = posEndpoint({
  method: 'post',
  path: '/refunds',
  status: 201,
  body: refundBody,
  handler: async (req, body) => {
    const user = await requireUser(req, STAFF)
    return inTransaction(req, async () => {
      // Serialises refunds of one sale so two cannot both pass the quantity check.
      if (!(await lockRow(req, 'sales', body.saleId))) {
        throw new PosError(404, 'sale_not_found', 'Sale not found')
      }
      const sale = await loadSale(req, user, body.saleId)
      const outletId = relId(sale.outlet as number)!

      if (!(await lockRow(req, 'shifts', body.shiftId))) {
        throw new PosError(404, 'shift_not_found', 'Shift not found')
      }
      const shift = await req.payload.findByID({
        collection: 'shifts',
        id: body.shiftId,
        ...local(req),
      })
      if (shift.status !== 'open') throw new PosError(409, 'shift_closed', 'Open a shift first')
      if (relId(shift.outlet as number) !== outletId) {
        throw new PosError(409, 'wrong_outlet', 'Refund at the outlet where the sale was made')
      }
      if (relId(shift.cashier as number) !== user.id && !hasRole(user, ...MANAGERS)) {
        throw new PosError(403, 'not_your_shift', 'Refund on your own shift')
      }

      const totals = await priceRefund(req, sale, body.lines)

      const methods = await req.payload.find({
        collection: 'payment-methods',
        where: { id: { in: body.payouts.map((p) => p.paymentMethodId) } },
        pagination: false,
        ...local(req),
      })
      const byId = new Map(methods.docs.map((m) => [m.id, m]))
      const payouts = body.payouts.map((payout) => {
        const method = byId.get(payout.paymentMethodId) as PaymentMethod | undefined
        if (!method?.enabled) {
          throw new PosError(
            409,
            'payment_method_unavailable',
            'This payment method is not available',
          )
        }
        if (method.requiresReference && !payout.reference) {
          throw new PosError(422, 'reference_required', `${method.label} needs a reference`)
        }
        return { ...payout, method }
      })
      const paidOut = payouts.reduce((sum, p) => sum + p.amount, 0)
      if (paidOut !== totals.total) {
        throw new PosError(422, 'payout_mismatch', `Pay out exactly ${totals.total}`)
      }

      const approver = await verifyManagerApproval(req, user, body.approval, {
        outletId,
        action: 'refund',
        details: { sale: sale.id, receiptNumber: sale.receiptNumber, total: totals.total },
      })

      const saleLines = new Map(sale.lines.map((line) => [line.id!, line]))
      const restock = new Map(body.lines.map((line) => [line.saleLineId, line.restock]))
      const refund = await req.payload.create({
        collection: 'refunds',
        data: {
          sale: sale.id,
          outlet: outletId,
          register: relId(shift.register as number)!,
          shift: shift.id,
          lines: totals.lines.map((line) => {
            const saleLine = saleLines.get(line.lineId)!
            return {
              saleLineId: line.lineId,
              variant: relId(saleLine.variant as number)!,
              name: saleLine.name,
              sku: saleLine.sku,
              quantity: line.quantity,
              taxRatePercent: line.taxRatePercent,
              tax: line.tax,
              total: line.total,
              restock: restock.get(line.lineId) ?? true,
            }
          }),
          taxTotal: totals.taxTotal,
          total: totals.total,
          payouts: payouts.map((p) => ({
            paymentMethod: p.method.id,
            methodCode: p.method.code,
            methodLabel: p.method.label,
            methodType: p.method.type,
            amount: p.amount,
            reference: p.reference,
          })),
          processedBy: user.id,
          approvedBy: approver.id,
          reason: body.reason,
        },
        ...local(req),
      })

      if (activeModules(await loadSettings(req)).inventory) {
        for (const line of refund.lines) {
          if (!line.restock) continue
          await applyStockChange(req, {
            variantId: relId(line.variant as number)!,
            outletId,
            delta: line.quantity,
            type: 'refund',
            userId: user.id,
            reference: sale.receiptNumber,
            reason: body.reason,
          })
        }
      }
      return { refund }
    })
  },
})

export const refundEndpoints = [refundableLines, previewRefund, createRefund]
