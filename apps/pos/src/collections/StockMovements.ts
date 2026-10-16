import type { CollectionConfig } from 'payload'

import { nobody, outletScoped } from '../access/roles'
import { integerField, outletField } from '../fields/common'

export const STOCK_MOVEMENT_TYPES = ['initial', 'sale', 'refund', 'adjustment'] as const

/**
 * Append-only audit trail of every stock change (FR-23). Created only by server endpoints;
 * never updated or deleted. Corrections are new adjustment movements.
 */
export const StockMovements: CollectionConfig = {
  slug: 'stock-movements',
  admin: {
    defaultColumns: ['createdAt', 'variant', 'outlet', 'delta', 'type', 'user'],
    group: 'Inventory',
  },
  defaultSort: '-createdAt',
  access: {
    read: outletScoped(['admin', 'manager']),
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    {
      name: 'variant',
      type: 'relationship',
      relationTo: 'product-variants',
      required: true,
      index: true,
    },
    outletField(),
    integerField({ name: 'delta', required: true }),
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [...STOCK_MOVEMENT_TYPES],
      index: true,
    },
    {
      name: 'reference',
      type: 'text',
      admin: { description: 'Receipt number of the sale or refund, if any.' },
    },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true },
    { name: 'reason', type: 'text' },
  ],
}
