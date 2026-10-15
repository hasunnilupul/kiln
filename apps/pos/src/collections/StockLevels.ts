import type { CollectionConfig } from 'payload'

import { nobody, outletScoped } from '../access/roles'
import { integerField, outletField } from '../fields/common'

/**
 * Stock per variant per outlet (FR-22). `quantity` always equals the sum of the variant's
 * `stock-movements` at the outlet, so it is written only by server endpoints, in the same
 * transaction as the movement. Negative stock is allowed (FR-24).
 */
export const StockLevels: CollectionConfig = {
  slug: 'stock-levels',
  admin: {
    defaultColumns: ['variant', 'outlet', 'quantity'],
    group: 'Inventory',
  },
  access: {
    read: outletScoped(['admin', 'manager', 'cashier']),
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  indexes: [{ fields: ['variant', 'outlet'], unique: true }],
  fields: [
    { name: 'variant', type: 'relationship', relationTo: 'product-variants', required: true },
    outletField(),
    integerField({ name: 'quantity', required: true, defaultValue: 0 }),
  ],
}
