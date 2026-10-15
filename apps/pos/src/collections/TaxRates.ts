import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, nobody } from '../access/roles'
import { codeField, percentField } from '../fields/common'
import { auditCollectionChange } from '../hooks/audit'

/** Seeded from the client config; editable by admins after go-live (FR-80). */
export const TaxRates: CollectionConfig = {
  slug: 'tax-rates',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['code', 'name', 'ratePercent', 'active'],
    group: 'Setup',
  },
  access: {
    read: isStaff,
    create: isAdmin,
    update: isAdmin,
    // Products reference tax rates; deactivate instead.
    delete: nobody,
  },
  hooks: {
    afterChange: [auditCollectionChange],
  },
  fields: [
    codeField(),
    { name: 'name', type: 'text', required: true },
    percentField({ name: 'ratePercent', required: true }),
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { position: 'sidebar' } },
  ],
}
