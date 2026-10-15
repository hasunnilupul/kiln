import type { CollectionConfig } from 'payload'

import { isAdmin, isManager, isStaff } from '../access/roles'

/** Customers attached to sales when the `customers` module is on (FR-33). */
export const Customers: CollectionConfig = {
  slug: 'customers',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'phone', 'email'],
    group: 'Sales',
  },
  access: {
    read: isStaff,
    // Cashiers can add a customer at the till.
    create: isStaff,
    update: isManager,
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'phone', type: 'text', index: true },
    { name: 'email', type: 'email' },
    { name: 'notes', type: 'textarea' },
  ],
}
