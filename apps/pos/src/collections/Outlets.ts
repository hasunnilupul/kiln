import type { CollectionConfig } from 'payload'

import { isAdmin, nobody, outletScoped } from '../access/roles'
import { codeField } from '../fields/common'
import { auditCollectionChange } from '../hooks/audit'

export const Outlets: CollectionConfig = {
  slug: 'outlets',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['code', 'name', 'active'],
    group: 'Setup',
  },
  access: {
    read: outletScoped(['admin', 'manager', 'cashier'], 'id'),
    create: isAdmin,
    update: isAdmin,
    // Sales and stock reference outlets; deactivate instead.
    delete: nobody,
  },
  hooks: {
    afterChange: [auditCollectionChange],
  },
  fields: [
    codeField(),
    { name: 'name', type: 'text', required: true },
    { name: 'address', type: 'textarea' },
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { position: 'sidebar' } },
  ],
}
