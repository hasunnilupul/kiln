import type { CollectionConfig } from 'payload'

import { isOwner, nobody } from '../access/owner'

/**
 * Every builder action with actor, IP and time (BR-04). Written only by server code (see
 * `hooks/audit.ts`); never edited or deleted. `createdAt` is the time of the action.
 */
export const AuditLog: CollectionConfig = {
  slug: 'audit-log',
  admin: {
    defaultColumns: ['createdAt', 'actor', 'action', 'entity', 'entityId', 'ip'],
    group: 'System',
  },
  defaultSort: '-createdAt',
  access: {
    read: isOwner,
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
      admin: { description: 'Empty for system actions and failed sign-ins.' },
    },
    { name: 'action', type: 'text', required: true, index: true },
    { name: 'entity', type: 'text', required: true, index: true },
    { name: 'entityId', type: 'text', index: true },
    { name: 'ip', type: 'text' },
    { name: 'data', type: 'json' },
  ],
}
