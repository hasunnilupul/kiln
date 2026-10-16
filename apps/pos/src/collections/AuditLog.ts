import type { CollectionConfig } from 'payload'

import { isAdmin, nobody } from '../access/roles'

/**
 * Approvals, stock adjustments and settings changes. Written only by server code (see
 * `hooks/audit.ts`); never edited or deleted. `createdAt` is the time of the action.
 */
export const AuditLog: CollectionConfig = {
  slug: 'audit-log',
  admin: {
    defaultColumns: ['createdAt', 'actor', 'action', 'entity', 'entityId'],
    group: 'System',
  },
  defaultSort: '-createdAt',
  access: {
    read: isAdmin,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: { description: 'Empty for system actions such as first-boot seeding.' },
    },
    { name: 'action', type: 'text', required: true, index: true },
    { name: 'entity', type: 'text', required: true, index: true },
    { name: 'entityId', type: 'text', index: true },
    { name: 'data', type: 'json' },
  ],
}
