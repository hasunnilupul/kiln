import type { GlobalConfig } from 'payload'

import { DATE_FORMATS, MODULE_NAMES } from '@kiln/client-config'

import { isAdmin, isStaff, nobodyField } from '../access/roles'
import { auditGlobalChange } from '../hooks/audit'

/**
 * Business details, locale, modules and receipt options. Seeded from `client.config.json` on
 * first boot (FR-02); admins edit them afterwards (FR-80). Modules only hide features; a module
 * missing from the licence stays off whatever this says.
 */
export const SystemSettings: GlobalConfig = {
  slug: 'system-settings',
  admin: {
    group: 'Setup',
  },
  access: {
    read: isStaff,
    update: isAdmin,
  },
  hooks: {
    afterChange: [auditGlobalChange],
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Business',
          fields: [
            { name: 'legalName', type: 'text', required: true },
            { name: 'displayName', type: 'text', required: true },
            { name: 'address', type: 'textarea' },
            { name: 'phone', type: 'text' },
            { name: 'email', type: 'email' },
            { name: 'taxRegistrationNo', type: 'text' },
          ],
        },
        {
          label: 'Locale and tax',
          fields: [
            {
              name: 'currency',
              type: 'text',
              required: true,
              // Money is stored in this currency's minor units; changing it would corrupt history.
              access: { update: nobodyField },
              admin: { readOnly: true, description: 'ISO 4217 code. Fixed at setup.' },
            },
            {
              name: 'locale',
              type: 'text',
              required: true,
              admin: { description: 'BCP 47, e.g. en-US.' },
            },
            {
              name: 'timezone',
              type: 'text',
              required: true,
              admin: { description: 'IANA time zone, e.g. Asia/Colombo.' },
            },
            { name: 'dateFormat', type: 'select', required: true, options: [...DATE_FORMATS] },
            {
              name: 'pricesIncludeTax',
              type: 'checkbox',
              defaultValue: true,
              admin: { description: 'Product prices include tax.' },
            },
            { name: 'defaultTaxRate', type: 'relationship', relationTo: 'tax-rates' },
          ],
        },
        {
          label: 'Modules',
          fields: [
            {
              name: 'modules',
              type: 'group',
              fields: MODULE_NAMES.map((name) => ({
                name,
                type: 'checkbox' as const,
                defaultValue: false,
              })),
            },
          ],
        },
        {
          label: 'Receipt',
          fields: [
            {
              name: 'receipt',
              type: 'group',
              fields: [
                {
                  name: 'paperWidthMm',
                  type: 'select',
                  required: true,
                  defaultValue: '80',
                  options: [
                    { label: '58 mm', value: '58' },
                    { label: '80 mm', value: '80' },
                  ],
                },
                { name: 'showTaxBreakdown', type: 'checkbox', defaultValue: true },
                { name: 'showCashierName', type: 'checkbox', defaultValue: true },
              ],
            },
          ],
        },
        {
          label: 'System',
          fields: [
            {
              name: 'clientId',
              type: 'text',
              access: { update: nobodyField },
              admin: {
                readOnly: true,
                description: 'Client ID from the config; must match the licence.',
              },
            },
            {
              name: 'configSchemaVersion',
              type: 'number',
              access: { update: nobodyField },
              admin: { readOnly: true },
            },
            {
              name: 'seededAt',
              type: 'date',
              access: { update: nobodyField },
              admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } },
            },
          ],
        },
      ],
    },
  ],
}
