import type { CollectionConfig } from 'payload'

import { isManager, isStaff, nobody } from '../access/roles'

/** Base item (FR-20). Every sellable item is a `product-variants` row; simple products have one. */
export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'sku', 'category', 'active'],
    group: 'Catalogue',
  },
  access: {
    read: isStaff,
    create: isManager,
    update: isManager,
    // Sales and stock reference products through variants; deactivate instead.
    delete: nobody,
  },
  fields: [
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'sku', type: 'text', required: true, unique: true, index: true },
    { name: 'category', type: 'relationship', relationTo: 'categories', index: true },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'taxRate', type: 'relationship', relationTo: 'tax-rates', required: true },
    {
      name: 'hasVariants',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Sold in variants such as size or colour (FR-21).' },
    },
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { position: 'sidebar' } },
    {
      name: 'variants',
      type: 'join',
      collection: 'product-variants',
      on: 'product',
    },
  ],
}
