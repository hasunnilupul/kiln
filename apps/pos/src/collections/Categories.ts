import type { CollectionConfig } from 'payload'

import { isManager, isStaff } from '../access/roles'
import { integerField } from '../fields/common'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'parent', 'sortOrder'],
    group: 'Catalogue',
  },
  defaultSort: 'sortOrder',
  access: {
    read: isStaff,
    create: isManager,
    update: isManager,
    delete: isManager,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'parent', type: 'relationship', relationTo: 'categories' },
    integerField({ name: 'sortOrder', defaultValue: 0, admin: { position: 'sidebar' } }),
    {
      name: 'colour',
      type: 'text',
      validate: (value: string | null | undefined) =>
        !value || /^#[0-9A-Fa-f]{6}$/.test(value) || 'Use a six-digit hex colour such as #0F766E.',
      admin: { description: 'Tile colour on the checkout grid, e.g. #0F766E.' },
    },
  ],
}
