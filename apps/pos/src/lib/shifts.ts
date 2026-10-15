import { summariseShift, type ShiftSummary } from '@kiln/pricing'
import type { PayloadRequest } from 'payload'

import type { Shift } from '../payload-types'

/** Totals a shift from its sales, refunds and cash movements (FR-61, FR-72). */
export async function loadShiftSummary(req: PayloadRequest, shift: Shift): Promise<ShiftSummary> {
  const common = {
    where: { shift: { equals: shift.id } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  } as const
  const [sales, refunds, movements] = await Promise.all([
    req.payload.find({ collection: 'sales', ...common }),
    req.payload.find({ collection: 'refunds', ...common }),
    req.payload.find({ collection: 'cash-movements', ...common }),
  ])

  return summariseShift({
    openingFloat: shift.openingFloat,
    sales: sales.docs.map((sale) => ({
      total: sale.total,
      change: sale.change,
      payments: sale.payments.map((p) => ({
        methodCode: p.methodCode,
        isCash: p.methodType === 'cash',
        amount: p.amount,
      })),
    })),
    refunds: refunds.docs.map((refund) => ({
      total: refund.total,
      payouts: refund.payouts.map((p) => ({
        methodCode: p.methodCode,
        isCash: p.methodType === 'cash',
        amount: p.amount,
      })),
    })),
    cashMovements: movements.docs.map((m) => ({ type: m.type, amount: m.amount })),
  })
}
