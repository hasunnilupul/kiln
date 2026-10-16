import type { GlobalConfig } from 'payload'

import { anyone, isAdmin } from '../access/roles'
import { auditGlobalChange } from '../hooks/audit'

const hexColor = (value: string | null | undefined) =>
  !value || /^#[0-9A-Fa-f]{6}$/.test(value) || 'Use a six-digit hex colour such as #0F766E.'

/**
 * Logo, colours and receipt text (FR-81). Seeded from the client config; editable by admins.
 * Readable without login so sign-in screens can be branded; it holds nothing sensitive.
 */
export const Branding: GlobalConfig = {
  slug: 'branding',
  admin: {
    group: 'Setup',
  },
  access: {
    read: anyone,
    update: isAdmin,
  },
  hooks: {
    afterChange: [auditGlobalChange],
  },
  fields: [
    { name: 'logo', type: 'upload', relationTo: 'media' },
    {
      name: 'primaryColor',
      type: 'text',
      required: true,
      defaultValue: '#0F766E',
      validate: hexColor,
    },
    {
      name: 'accentColor',
      type: 'text',
      required: true,
      defaultValue: '#F59E0B',
      validate: hexColor,
    },
    { name: 'receiptHeader', type: 'textarea' },
    { name: 'receiptFooter', type: 'textarea' },
  ],
}
