import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { hasRole } from '../../access/roles'
import { inTransaction, lockRow } from '../../lib/db'
import { licensedRegisterLimit } from '../../lib/licence'
import { loadShiftSummary } from '../../lib/shifts'
import type { Shift } from '../../payload-types'
import {
  MANAGERS,
  PosError,
  STAFF,
  type StaffUser,
  assertOutletAccess,
  id,
  money,
  posEndpoint,
  relId,
  requireUser,
  routeId,
} from './http'

const write = (req: PayloadRequest) => ({ overrideAccess: true, req, depth: 0 }) as const

/** Registers beyond the licence's `maxRegisters` cannot open shifts (FR-04); oldest first. */
async function assertRegisterLicensed(req: PayloadRequest, registerId: number) {
  const limit = licensedRegisterLimit()
  if (limit === null) return
  const allowed = await req.payload.find({
    collection: 'registers',
    where: { active: { equals: true } },
    sort: 'id',
    limit: Math.max(limit, 1),
    ...write(req),
  })
  if (limit === 0 || !allowed.docs.some((register) => register.id === registerId)) {
    throw new PosError(403, 'register_not_licensed', `The licence allows ${limit} register(s)`)
  }
}

/** Locks and loads a shift, checking the user may act on it. Cashiers act only on their own. */
async function lockShift(req: PayloadRequest, user: StaffUser, shiftId: number) {
  if (!(await lockRow(req, 'shifts', shiftId))) {
    throw new PosError(404, 'shift_not_found', 'Shift not found')
  }
  const shift = await req.payload.findByID({ collection: 'shifts', id: shiftId, ...write(req) })
  assertOutletAccess(user, shift.outlet as number)
  if (hasRole(user, 'cashier') && relId(shift.cashier as number) !== user.id) {
    throw new PosError(403, 'not_your_shift', 'This is another cashier’s shift')
  }
  return shift
}

function assertOpen(shift: Shift) {
  if (shift.status !== 'open') {
    throw new PosError(409, 'shift_closed', 'This shift is already closed')
  }
}

/** `POST /api/pos/shifts/open`: open a shift on a register with an opening float (FR-60). */
export const openShift = posEndpoint({
  method: 'post',
  path: '/shifts/open',
  status: 201,
  body: z.object({ registerId: id, openingFloat: money }),
  handler: async (req, body) => {
    const user = await requireUser(req, STAFF)
    return inTransaction(req, async () => {
      // Serialises opens on one register so it never has two open shifts.
      if (!(await lockRow(req, 'registers', body.registerId))) {
        throw new PosError(404, 'register_not_found', 'Register not found')
      }
      const register = await req.payload.findByID({
        collection: 'registers',
        id: body.registerId,
        ...write(req),
      })
      assertOutletAccess(user, register.outlet as number)
      if (!register.active) {
        throw new PosError(409, 'register_inactive', 'This register is not active')
      }
      await assertRegisterLicensed(req, register.id)

      const open = await req.payload.find({
        collection: 'shifts',
        where: {
          status: { equals: 'open' },
          or: [{ register: { equals: register.id } }, { cashier: { equals: user.id } }],
        },
        limit: 1,
        ...write(req),
      })
      const existing = open.docs[0]
      if (existing) {
        throw relId(existing.register as number) === register.id
          ? new PosError(409, 'register_has_open_shift', 'This register already has an open shift')
          : new PosError(409, 'cashier_has_open_shift', 'You already have an open shift')
      }

      return req.payload.create({
        collection: 'shifts',
        data: {
          register: register.id,
          outlet: register.outlet as number,
          cashier: user.id,
          status: 'open',
          openedAt: new Date().toISOString(),
          openingFloat: body.openingFloat,
        },
        ...write(req),
      })
    })
  },
})

/** `POST /api/pos/shifts/:id/cash-movements`: managers pay cash in or out of the drawer (FR-62). */
export const recordCashMovement = posEndpoint({
  method: 'post',
  path: '/shifts/:id/cash-movements',
  status: 201,
  body: z.object({
    type: z.enum(['in', 'out']),
    amount: money.positive(),
    reason: z.string().trim().min(1).max(200),
  }),
  handler: async (req, body) => {
    const user = await requireUser(req, MANAGERS)
    const shiftId = routeId(req)
    return inTransaction(req, async () => {
      const shift = await lockShift(req, user, shiftId)
      assertOpen(shift)
      return req.payload.create({
        collection: 'cash-movements',
        data: { shift: shift.id, outlet: shift.outlet as number, user: user.id, ...body },
        ...write(req),
      })
    })
  },
})

/**
 * `POST /api/pos/shifts/:id/close`: record counted cash and close the shift, returning expected
 * cash, variance and the shift summary (FR-61).
 */
export const closeShift = posEndpoint({
  method: 'post',
  path: '/shifts/:id/close',
  body: z.object({ countedCash: money }),
  handler: async (req, body) => {
    const user = await requireUser(req, STAFF)
    const shiftId = routeId(req)
    return inTransaction(req, async () => {
      // The lock also waits for in-flight sales on this shift to finish.
      const shift = await lockShift(req, user, shiftId)
      assertOpen(shift)
      const summary = await loadShiftSummary(req, shift)
      const closed = await req.payload.update({
        collection: 'shifts',
        id: shift.id,
        data: {
          status: 'closed',
          closedAt: new Date().toISOString(),
          expectedCash: summary.expectedCash,
          countedCash: body.countedCash,
          variance: body.countedCash - summary.expectedCash,
        },
        ...write(req),
      })
      return { shift: closed, summary }
    })
  },
})

/** `GET /api/pos/shifts/:id/summary`: running or final totals for a shift (FR-61, FR-72). */
export const shiftSummary = posEndpoint({
  method: 'get',
  path: '/shifts/:id/summary',
  handler: async (req) => {
    const user = await requireUser(req, STAFF)
    const shiftId = routeId(req)
    return inTransaction(req, async () => {
      const shift = await lockShift(req, user, shiftId)
      return { shift, summary: await loadShiftSummary(req, shift) }
    })
  },
})

export const shiftEndpoints = [openShift, recordCashMovement, closeShift, shiftSummary]
