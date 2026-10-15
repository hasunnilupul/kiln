import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { hasRole, outletIds } from '../access/roles'
import { PosError, id, type StaffUser } from '../endpoints/pos/http'
import { writeAudit } from '../hooks/audit'
import { PIN_PATTERN, pinLockRemaining, recordPinAttempt, verifyPinHash } from './pin'

/** A manager's consent, given by choosing them on the till and entering their PIN (FR-13). */
export const approvalSchema = z.object({
  managerId: id,
  pin: z.string().regex(PIN_PATTERN, 'A PIN is 4 to 6 digits'),
})
export type Approval = z.infer<typeof approvalSchema>

/** Throws unless `userId` may try a PIN now. */
export function assertPinNotLocked(userId: number) {
  const remaining = pinLockRemaining(userId)
  if (remaining > 0) {
    throw new PosError(
      429,
      'pin_locked',
      `Too many wrong PINs; try again in ${Math.ceil(remaining / 60000)} minute(s)`,
    )
  }
}

/** Checks a PIN against a user's stored hash and counts the attempt. */
export async function checkPin(req: PayloadRequest, userId: number, pin: string) {
  assertPinNotLocked(userId)
  const user = await req.payload
    .findByID({
      collection: 'users',
      id: userId,
      depth: 0,
      overrideAccess: true,
      showHiddenFields: true,
      req,
    })
    .catch(() => null)
  const ok = Boolean(user) && (await verifyPinHash(pin, user!.pinHash))
  recordPinAttempt(userId, ok)
  return ok ? user! : null
}

/**
 * Verifies a manager approval for `action` at `outletId` and writes it to the audit log (FR-13).
 * The approver must be an admin, or a manager working at the outlet.
 */
export async function verifyManagerApproval(
  req: PayloadRequest,
  requester: StaffUser,
  approval: Approval | undefined,
  {
    outletId,
    action,
    details,
  }: { outletId: number; action: string; details?: Record<string, unknown> },
): Promise<StaffUser> {
  if (!approval) {
    throw new PosError(403, 'approval_required', 'A manager must approve this')
  }
  const manager = await checkPin(req, approval.managerId, approval.pin)
  const approver = manager ? ({ ...manager, collection: 'users' } as StaffUser) : null
  const allowed =
    approver &&
    (hasRole(approver, 'admin') ||
      (hasRole(approver, 'manager') && outletIds(approver).includes(outletId)))
  if (!approver || !allowed) {
    throw new PosError(403, 'approval_denied', 'Manager PIN not accepted')
  }
  await writeAudit(req, {
    action: 'approval',
    entity: action,
    data: { approvedBy: approver.id, requestedBy: requester.id, outlet: outletId, ...details },
  })
  return approver
}
