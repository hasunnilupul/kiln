import type { CollectionConfig } from 'payload'

import { isAdmin, nobody, nobodyField, outletScoped } from '../access/roles'
import { codeField, integerField, outletField } from '../fields/common'
import { auditCollectionChange } from '../hooks/audit'

export const Registers: CollectionConfig = {
  slug: 'registers',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['code', 'name', 'outlet', 'active'],
    group: 'Setup',
  },
  access: {
    read: outletScoped(['admin', 'manager', 'cashier']),
    create: isAdmin,
    update: isAdmin,
    // Sales and shifts reference registers; deactivate instead.
    delete: nobody,
  },
  hooks: {
    afterChange: [auditCollectionChange],
  },
  fields: [
    codeField(),
    { name: 'name', type: 'text', required: true },
    outletField(),
    integerField(
      {
        name: 'nextSaleNumber',
        required: true,
        defaultValue: 1,
        // Incremented only inside the sale finalisation transaction (FR-42).
        access: { create: nobodyField, update: nobodyField },
        admin: { readOnly: true, position: 'sidebar' },
      },
      { min: 1 },
    ),
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { position: 'sidebar' } },
  ],
}
