import type { CollectionConfig } from 'payload'

import { PAYMENT_METHOD_TYPES } from '@kiln/client-config'

import { nobody, outletScoped } from '../access/roles'
import { integerField, moneyField, outletField, percentField } from '../fields/common'

/**
 * Completed sales. Created only by `/api/pos/sales/finalise` inside one transaction (FR-42) and
 * immutable afterwards (FR-52). Lines snapshot name, SKU, price and tax rate at the time of sale.
 * `total = sum(payments.amount) − change`.
 */
export const Sales: CollectionConfig = {
  slug: 'sales',
  admin: {
    useAsTitle: 'receiptNumber',
    defaultColumns: ['receiptNumber', 'completedAt', 'outlet', 'cashier', 'total'],
    group: 'Sales',
  },
  defaultSort: '-completedAt',
  access: {
    // Cashiers look sales up in their outlets for reprints and refunds (FR-44, FR-50).
    read: outletScoped(['admin', 'manager', 'cashier']),
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  indexes: [{ fields: ['register', 'number'], unique: true }],
  fields: [
    {
      name: 'receiptNumber',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'Register code and sale number, e.g. R1-000042. Printed as the receipt barcode.',
      },
    },
    integerField(
      { name: 'number', required: true, admin: { description: 'Sequential per register.' } },
      { min: 1 },
    ),
    { name: 'register', type: 'relationship', relationTo: 'registers', required: true },
    outletField(),
    { name: 'shift', type: 'relationship', relationTo: 'shifts', required: true, index: true },
    { name: 'cashier', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'customer', type: 'relationship', relationTo: 'customers', index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'completed',
      options: ['completed'],
    },
    {
      name: 'completedAt',
      type: 'date',
      required: true,
      index: true,
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'pricesIncludeTax',
      type: 'checkbox',
      required: true,
      admin: { description: 'Tax basis of the unit prices at the time of sale.' },
    },
    {
      name: 'lines',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        {
          name: 'variant',
          type: 'relationship',
          relationTo: 'product-variants',
          required: true,
          index: true,
        },
        { name: 'name', type: 'text', required: true },
        { name: 'sku', type: 'text', required: true },
        moneyField({ name: 'unitPrice', required: true }),
        integerField({ name: 'quantity', required: true }, { min: 1 }),
        percentField({ name: 'taxRatePercent', required: true }),
        moneyField({ name: 'gross', required: true }),
        moneyField({ name: 'lineDiscount', required: true }),
        moneyField({ name: 'cartDiscount', required: true }),
        moneyField({ name: 'tax', required: true }),
        moneyField({ name: 'total', required: true }),
      ],
    },
    moneyField({ name: 'subtotal', required: true }),
    moneyField({ name: 'discountTotal', required: true }),
    moneyField({ name: 'taxTotal', required: true }),
    moneyField({ name: 'total', required: true }),
    {
      name: 'payments',
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
    moneyField({ name: 'change', required: true, defaultValue: 0 }),
  ],
}
