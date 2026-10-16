import type { CollectionConfig } from 'payload'

import { isManager, isStaff, nobody } from '../access/roles'
import { moneyField } from '../fields/common'

/** A sellable item with its own SKU, barcodes and price (FR-20, FR-21). */
export const ProductVariants: CollectionConfig = {
  slug: 'product-variants',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'sku', 'product', 'price', 'active'],
    group: 'Catalogue',
  },
  access: {
    read: isStaff,
    create: isManager,
    update: isManager,
    // Stock levels and movements reference variants; deactivate instead.
    delete: nobody,
  },
  fields: [
    { name: 'product', type: 'relationship', relationTo: 'products', required: true, index: true },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'e.g. "Large / Blue", or the product name for a simple product.' },
    },
    { name: 'sku', type: 'text', required: true, unique: true, index: true },
    {
      name: 'barcodes',
      type: 'array',
      labels: { singular: 'Barcode', plural: 'Barcodes' },
      fields: [{ name: 'code', type: 'text', required: true, unique: true, index: true }],
    },
    moneyField({
      name: 'price',
      required: true,
      admin: {
        description: 'Minor units (cents). Includes tax if prices include tax in settings.',
      },
    }),
    moneyField({ name: 'cost', admin: { description: 'Minor units (cents). Optional.' } }),
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { position: 'sidebar' } },
  ],
}
