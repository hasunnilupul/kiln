import type { CollectionConfig } from 'payload'

import { PAYMENT_METHOD_TYPES } from '@kiln/client-config'

import { nobody, outletScoped } from '../access/roles'
import { integerField, moneyField, outletField, percentField } from '../fields/common'

/**
 * Full or partial refunds against a completed sale (FR-50, FR-51). Created only by
 * `/api/pos/refunds` inside one transaction, with manager approval (FR-13); never edited.
 * Refunded quantities never exceed what was sold.
 */
export const Refunds: CollectionConfig = {
  slug: 'refunds',
  admin: {
    defaultColumns: ['createdAt', 'sale', 'outlet', 'total', 'approvedBy'],
    group: 'Sales',
  },
  defaultSort: '-createdAt',
  access: {
    read: outletScoped(['admin', 'manager', 'cashier']),
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    { name: 'sale', type: 'relationship', relationTo: 'sales', required: true, index: true },
    outletField(),
    { name: 'register', type: 'relationship', relationTo: 'registers', required: true },
    {
      name: 'shift',
      type: 'relationship',
      relationTo: 'shifts',
      required: true,
      index: true,
      admin: { description: 'Shift the payout was made from.' },
    },
    {
      name: 'lines',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'saleLineId', type: 'text', required: true },
        { name: 'variant', type: 'relationship', relationTo: 'product-variants', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'sku', type: 'text', required: true },
        integerField({ name: 'quantity', required: true }, { min: 1 }),
        percentField({ name: 'taxRatePercent', required: true }),
        moneyField({ name: 'tax', required: true }),
        moneyField({ name: 'total', required: true }),
        { name: 'restock', type: 'checkbox', required: true, defaultValue: true },
      ],
    },
    moneyField({ name: 'taxTotal', required: true }),
    moneyField({ name: 'total', required: true }),
    {
      name: 'payouts',
      type: 'array',
      required: true,
      fields: [
        {
          name: 'paymentMethod',
          type: 'relationship',
          relationTo: 'payment-methods',
          required: true,
        },
        { name: 'methodCode', type: 'text', required: true },
        { name: 'methodLabel', type: 'text', required: true },
        { name: 'methodType', type: 'select', required: true, options: [...PAYMENT_METHOD_TYPES] },
        moneyField({ name: 'amount', required: true }),
        { name: 'reference', type: 'text' },
      ],
    },
    { name: 'processedBy', type: 'relationship', relationTo: 'users', required: true },
    { name: 'approvedBy', type: 'relationship', relationTo: 'users', required: true },
    { name: 'reason', type: 'text', required: true },
  ],
}
