import { z } from 'zod'

import { hasRole, outletIds } from '../../access/roles'
import { checkPin } from '../../lib/approvals'
import { hashPin, PIN_PATTERN, signActingToken } from '../../lib/pin'
import { writeAudit } from '../../hooks/audit'
import {
  PosError,
  STAFF,
  id,
  posEndpoint,
  requireDeviceUser,
  routeId,
  type StaffUser,
} from './http'

const pin = z.string().regex(PIN_PATTERN, 'A PIN is 4 to 6 digits')

/** True when both users share an outlet, or the device user is an admin. */
function worksWith(device: StaffUser, other: { outlets?: (number | { id: number })[] | null }) {
  if (hasRole(device, 'admin')) return true
  const mine = outletIds(device)
  return (other.outlets ?? []).some((o) => mine.includes(typeof o === 'object' ? o.id : o))
}

/**
 * `GET /api/pos/staff`: staff the device user works with, for the till's switch-user and
 * manager-approval pickers. Only names, roles and whether a PIN is set; never the PIN.
 */
export const listStaff = posEndpoint({
  method: 'get',
  path: '/staff',
  handler: async (req) => {
    const device = requireDeviceUser(req)
    const users = await req.payload.find({
      collection: 'users',
      where: { mustChangePassword: { not_equals: true } },
      pagination: false,
      depth: 0,
      sort: 'name',
      overrideAccess: true,
      showHiddenFields: true,
      req,
    })
    return {
      staff: users.docs
        .filter((user) => user.id === device.id || worksWith(device, user))
        .map((user) => ({
          id: user.id,
          name: user.name,
          role: user.role,
          hasPin: Boolean(user.pinHash),
        })),
    }
  },
})

/** `POST /api/pos/me/pin`: set your own PIN, confirming your password (FR-12). */
export const setOwnPin = posEndpoint({
  method: 'post',
  path: '/me/pin',
  body: z.object({ password: z.string().min(1), pin }),
  handler: async (req, body) => {
    const device = requireDeviceUser(req)
    try {
      await req.payload.login({
        collection: 'users',
        data: { email: device.email, password: body.password },
        req,
      })
    } catch {
      throw new PosError(403, 'wrong_password', 'Password not accepted')
    }
    await req.payload.update({
      collection: 'users',
      id: device.id,
      data: { pinHash: await hashPin(body.pin) },
      overrideAccess: true,
      req,
    })
    await writeAudit(req, { action: 'set_pin', entity: 'users', entityId: device.id })
    return { ok: true }
  },
})

/** `POST /api/pos/users/:id/pin/reset`: admins clear a forgotten PIN. */
export const resetPin = posEndpoint({
  method: 'post',
  path: '/users/:id/pin/reset',
  handler: async (req) => {
    const admin = requireDeviceUser(req, ['admin'])
    const userId = routeId(req)
    await req.payload
      .update({
        collection: 'users',
        id: userId,
        data: { pinHash: null },
        overrideAccess: true,
        req,
      })
      .catch(() => {
        throw new PosError(404, 'user_not_found', 'User not found')
      })
    await writeAudit(req, {
      action: 'reset_pin',
      entity: 'users',
      entityId: userId,
      data: { by: admin.id },
    })
    return { ok: true }
  },
})

/**
 * `POST /api/pos/switch-user`: a colleague takes over the till with their PIN (FR-12). Returns a
 * token the till sends as `X-Kiln-Acting-User`; the device session stays signed in.
 */
export const switchUser = posEndpoint({
  method: 'post',
  path: '/switch-user',
  body: z.object({ userId: id, pin }),
  handler: async (req, body) => {
    const device = requireDeviceUser(req)
    const user = await checkPin(req, body.userId, body.pin)
    const staff = user ? ({ ...user, collection: 'users' } as StaffUser) : null
    if (
      !staff ||
      !hasRole(staff, ...STAFF) ||
      !(staff.id === device.id || worksWith(device, staff))
    ) {
      throw new PosError(403, 'pin_not_accepted', 'PIN not accepted')
    }
    return {
      token: signActingToken(req.payload.secret, { userId: staff.id, deviceUserId: device.id }),
      user: { id: staff.id, name: staff.name, role: staff.role },
    }
  },
})

export const staffEndpoints = [listStaff, setOwnPin, resetPin, switchUser]
