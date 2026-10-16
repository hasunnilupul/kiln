import { z } from 'zod'

import { approvalSchema, verifyManagerApproval } from '../../lib/approvals'
import { STAFF, assertOutletAccess, id, posEndpoint, relId, requireUser } from './http'

/**
 * `GET /api/pos/catalogue`: every sellable variant in a compact form, loaded once by the till so
 * barcode lookups and search run locally (FR-30; NFR: scan under 200 ms, search under 300 ms).
 */
export const catalogue = posEndpoint({
  method: 'get',
  path: '/catalogue',
  handler: async (req) => {
    await requireUser(req, STAFF)
    const local = { overrideAccess: true, pagination: false, req } as const
    const [variants, categories] = await Promise.all([
      req.payload.find({
        collection: 'product-variants',
        where: { active: { equals: true } },
        depth: 2,
        ...local,
      }),
      req.payload.find({ collection: 'categories', depth: 0, sort: 'sortOrder', ...local }),
    ])
    return {
      variants: variants.docs.flatMap((variant) => {
        const product = variant.product
        if (typeof product !== 'object' || !product.active) return []
        const taxRate = product.taxRate
        if (typeof taxRate !== 'object' || !taxRate.active) return []
        return [
          {
            id: variant.id,
            name: product.hasVariants ? `${product.name} ${variant.name}` : variant.name,
            sku: variant.sku,
            barcodes: (variant.barcodes ?? []).map((b) => b.code),
            price: variant.price,
            taxRatePercent: taxRate.ratePercent,
            categoryId: relId(product.category as number | null),
          },
        ]
      }),
      categories: categories.docs.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: relId(c.parent as number | null),
        colour: c.colour ?? null,
      })),
    }
  },
})

/** `GET /api/pos/shifts/current`: the acting user's open shift, if any (FR-60). */
export const currentShift = posEndpoint({
  method: 'get',
  path: '/shifts/current',
  handler: async (req) => {
    const user = await requireUser(req, STAFF)
    const found = await req.payload.find({
      collection: 'shifts',
      where: { cashier: { equals: user.id }, status: { equals: 'open' } },
      depth: 1,
      limit: 1,
      overrideAccess: true,
      req,
    })
    const shift = found.docs[0]
    const register = shift?.register
    return {
      user: { id: user.id, name: user.name, role: user.role },
      shift:
        shift && typeof register === 'object'
          ? {
              id: shift.id,
              openedAt: shift.openedAt,
              openingFloat: shift.openingFloat,
              register: { id: register.id, code: register.code, name: register.name },
              outletId: relId(shift.outlet as number),
            }
          : null,
    }
  },
})

/**
 * `POST /api/pos/approvals`: a manager approves a till-side action that changes no records itself,
 * such as voiding a line after payment has started (FR-13). The approval is audited.
 */
export const approveAction = posEndpoint({
  method: 'post',
  path: '/approvals',
  body: z.object({
    action: z.enum(['void_line']),
    outletId: id,
    approval: approvalSchema,
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  handler: async (req, body) => {
    const user = await requireUser(req, STAFF)
    assertOutletAccess(user, body.outletId)
    const approver = await verifyManagerApproval(req, user, body.approval, {
      outletId: body.outletId,
      action: body.action,
      details: body.details,
    })
    return { approvedBy: { id: approver.id, name: approver.name } }
  },
})

export const catalogueEndpoints = [catalogue, currentShift, approveAction]
