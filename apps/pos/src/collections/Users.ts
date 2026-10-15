import type { Access, CollectionBeforeChangeHook, CollectionConfig, FieldAccess } from 'payload'

import { ROLES, adminField, hasRole, isAdmin, nobodyField, outletIds } from '../access/roles'
import { auditCollectionChange, auditCollectionDelete } from '../hooks/audit'

/** Admins see everyone; managers see staff in their outlets; everyone sees themselves (FR-10, FR-11). */
const readUsers: Access = ({ req: { user } }) => {
  if (!user || user.collection !== 'users') return false
  if (hasRole(user, 'admin')) return true
  const self = { id: { equals: user.id } }
  const ids = outletIds(user)
  if (hasRole(user, 'manager') && ids.length > 0) {
    return { or: [self, { outlets: { in: ids } }] }
  }
  return self
}

/** Admins update anyone; everyone may update themselves (name, email, password). */
const updateUsers: Access = ({ req: { user } }) => {
  if (!user || user.collection !== 'users') return false
  return hasRole(user, 'admin') ? true : { id: { equals: user.id } }
}

/** Admins delete other users, never themselves. */
const deleteUsers: Access = ({ req: { user } }) =>
  hasRole(user, 'admin') ? { id: { not_equals: user!.id } } : false

/** Admins change other users' roles, never their own, so the last admin cannot demote themselves. */
const roleUpdate: FieldAccess = ({ id, req: { user } }) =>
  hasRole(user, 'admin') && id !== undefined && id !== user!.id

/** Changing your own password clears the forced-change flag (FR-03). */
const clearMustChangePassword: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (
    operation === 'update' &&
    typeof data.password === 'string' &&
    data.password.length > 0 &&
    req.user?.collection === 'users' &&
    req.user.id === originalDoc?.id
  ) {
    data.mustChangePassword = false
  }
  return data
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'email', 'role', 'outlets'],
    group: 'Staff',
  },
  auth: {
    tokenExpiration: 12 * 60 * 60,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
  },
  access: {
    // Cashiers work on the cashier screen; the admin panel is for admins and managers. Users who
    // must change their password still get in, but only to their own account.
    admin: ({ req: { user } }) =>
      Boolean(
        user && user.collection === 'users' && (user.role === 'admin' || user.role === 'manager'),
      ),
    create: isAdmin,
    read: readUsers,
    update: updateUsers,
    delete: deleteUsers,
    unlock: isAdmin,
  },
  hooks: {
    beforeChange: [clearMustChangePassword],
    afterChange: [auditCollectionChange],
    afterDelete: [auditCollectionDelete],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'cashier',
      options: ROLES.map((role) => ({
        label: role[0]!.toUpperCase() + role.slice(1),
        value: role,
      })),
      access: { create: adminField, update: roleUpdate },
      admin: { position: 'sidebar' },
    },
    {
      name: 'outlets',
      type: 'relationship',
      relationTo: 'outlets',
      hasMany: true,
      access: { create: adminField, update: adminField },
      admin: {
        position: 'sidebar',
        description: 'Outlets this user works in. Admins see every outlet.',
      },
    },
    {
      name: 'mustChangePassword',
      type: 'checkbox',
      // Users created by an admin get a temporary password and must replace it.
      defaultValue: true,
      access: { create: adminField, update: adminField },
      admin: {
        position: 'sidebar',
        description: 'Until the user changes their password, they can only edit their own account.',
      },
    },
    {
      // Set only through the PIN endpoint (FR-12); never exposed.
      name: 'pinHash',
      type: 'text',
      hidden: true,
      access: { create: nobodyField, read: nobodyField, update: nobodyField },
    },
  ],
}
