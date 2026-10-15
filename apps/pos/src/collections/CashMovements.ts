import type { CollectionConfig } from 'payload'

import { nobody, outletScoped } from '../access/roles'
import { moneyField, outletField } from '../fields/common'

/** Cash paid into or out of the drawer during a shift (FR-62). Created only by server endpoints. */
export const CashMovements: CollectionConfig = {
  slug: 'cash-movements',
  admin: {
    defaultColumns: ['createdAt', 'shift', 'type', 'amount', 'reason', 'user'],
    group: 'Sales',
  },
  defaultSort: '-createdAt',
  access: {
    read: outletScoped(['admin', 'manager']),
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    { name: 'shift', type: 'relationship', relationTo: 'shifts', required: true, index: true },
    outletField(),
    { name: 'type', type: 'select', required: true, options: ['in', 'out'] },
    moneyField({ name: 'amount', required: true }),
    { name: 'reason', type: 'text', required: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true },
  ],
}
