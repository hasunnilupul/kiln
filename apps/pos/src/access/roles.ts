import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

export const ROLES = ['admin', 'manager', 'cashier'] as const
export type Role = (typeof ROLES)[number]

type RequestUser = PayloadRequest['user']

/** The signed-in staff member, or null. Users who must change their password get no access (FR-03). */
function activeUser(user: RequestUser) {
  return user && user.collection === 'users' && !user.mustChangePassword ? user : null
}

export function hasRole(user: RequestUser, ...roles: Role[]): boolean {
  const active = activeUser(user)
  return Boolean(active && roles.includes(active.role))
}

/** IDs of the outlets a user is assigned to (FR-11). */
export function outletIds(user: RequestUser): number[] {
  if (!user || user.collection !== 'users') return []
  return (user.outlets ?? []).map((outlet) => (typeof outlet === 'object' ? outlet.id : outlet))
}

export const nobody: Access = () => false
export const anyone: Access = () => true
export const isAdmin: Access = ({ req }) => hasRole(req.user, 'admin')
export const isManager: Access = ({ req }) => hasRole(req.user, 'admin', 'manager')
export const isStaff: Access = ({ req }) => hasRole(req.user, 'admin', 'manager', 'cashier')

export const adminField: FieldAccess = ({ req }) => hasRole(req.user, 'admin')
export const nobodyField: FieldAccess = () => false

/**
 * Restricts documents to the user's outlets (FR-11). Admins see every outlet; users with no
 * outlets see nothing. `field` is the path of the outlet relationship (or `id` on outlets).
 */
export function outletScoped(roles: Role[], field = 'outlet'): Access {
  return ({ req }) => {
    if (!hasRole(req.user, ...roles)) return false
    if (hasRole(req.user, 'admin')) return true
    const ids = outletIds(req.user)
    return ids.length > 0 ? { [field]: { in: ids } } : false
  }
}

/**
 * Managers see documents in their outlets; cashiers see only documents where `ownerField` is them.
 */
export function outletScopedOrOwn(ownerField: string, outletField = 'outlet'): Access {
  const managers = outletScoped(['admin', 'manager'], outletField)
  return (args) => {
    if (hasRole(args.req.user, 'cashier')) {
      return { [ownerField]: { equals: args.req.user!.id } } satisfies Where
    }
    return managers(args)
  }
}
