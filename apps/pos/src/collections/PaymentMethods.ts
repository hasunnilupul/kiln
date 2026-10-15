import type { CollectionConfig } from 'payload'

import { PAYMENT_METHOD_TYPES } from '@kiln/client-config'

import { isAdmin, isStaff, nobody } from '../access/roles'
import { integerField } from '../fields/common'
import { auditCollectionChange } from '../hooks/audit'

/** Seeded from the client config; editable by admins after go-live (FR-40, FR-80). */
export const PaymentMethods: CollectionConfig = {
  slug: 'payment-methods',
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['code', 'label', 'type', 'enabled', 'sortOrder'],
    group: 'Setup',
  },
  defaultSort: 'sortOrder',
  access: {
    read: isStaff,
    create: isAdmin,
    update: isAdmin,
    // Sales reference payment methods; disable instead.
    delete: nobody,
  },
  hooks: {
    afterChange: [auditCollectionChange],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      validate: (value: string | null | undefined) =>
        (typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) ||
        'Use 1–32 lower-case letters, digits, "_" or "-".',
    },
    { name: 'label', type: 'text', required: true },
    { name: 'type', type: 'select', required: true, options: [...PAYMENT_METHOD_TYPES] },
    { name: 'enabled', type: 'checkbox', defaultValue: true },
    {
      name: 'requiresReference',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Cashier must enter a reference, e.g. the card approval code (FR-41).',
      },
    },
    integerField({ name: 'sortOrder', defaultValue: 0, admin: { position: 'sidebar' } }),
  ],
}
