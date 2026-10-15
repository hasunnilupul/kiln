import type { PayloadRequest } from 'payload'

import { execute, sql } from './db'

export interface StockChange {
  variantId: number
  outletId: number
  /** Units added (positive) or removed (negative). */
  delta: number
  type: 'initial' | 'sale' | 'refund' | 'adjustment'
  userId: number
  reference?: string
  reason?: string
}

/**
 * Records a stock movement and applies it to the stock level in the same transaction (FR-23), so
 * `stock-levels.quantity` always equals the sum of the movements. The level is updated with one
 * atomic upsert, so concurrent sales of the same item never lose an update. Negative stock is
 * allowed (FR-24). Must run inside `inTransaction`.
 */
export async function applyStockChange(req: PayloadRequest, change: StockChange): Promise<number> {
  await req.payload.create({
    collection: 'stock-movements',
    data: {
      variant: change.variantId,
      outlet: change.outletId,
      delta: change.delta,
      type: change.type,
      user: change.userId,
      reference: change.reference,
      reason: change.reason,
    },
    overrideAccess: true,
    depth: 0,
    req,
  })
  const [row] = await execute<{ quantity: string }>(
    req,
    sql`insert into stock_levels (variant_id, outlet_id, quantity)
        values (${change.variantId}, ${change.outletId}, ${change.delta})
        on conflict (variant_id, outlet_id)
        do update set quantity = stock_levels.quantity + excluded.quantity, updated_at = now()
        returning quantity`,
  )
  return Number(row!.quantity)
}
