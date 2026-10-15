import type { CollectionConfig } from 'payload'

import { nobody, outletScopedOrOwn } from '../access/roles'
import { moneyField, outletField } from '../fields/common'

/**
 * A cashier's shift on a register (FR-60, FR-61). Opened and closed only through server
 * endpoints, which also keep one open shift per register.
 */
export const Shifts: CollectionConfig = {
  slug: 'shifts',
  admin: {
    defaultColumns: ['register', 'cashier', 'openedAt', 'closedAt', 'status', 'variance'],
    group: 'Sales',
  },
  defaultSort: '-openedAt',
  access: {
    read: outletScopedOrOwn('cashier'),
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    {
      name: 'register',
      type: 'relationship',
      relationTo: 'registers',
      required: true,
      index: true,
    },
    outletField(),
    { name: 'cashier', type: 'relationship', relationTo: 'users', required: true, index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      options: ['open', 'closed'],
      index: true,
    },
    {
      name: 'openedAt',
      type: 'date',
      required: true,
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    moneyField({ name: 'openingFloat', required: true }),
    { name: 'closedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
    moneyField({ name: 'expectedCash' }),
    moneyField({ name: 'countedCash' }),
    moneyField(
      { name: 'variance', admin: { description: 'Counted minus expected cash.' } },
      { signed: true },
    ),
  ],
}
