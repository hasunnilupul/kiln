import type { CollectionConfig } from 'payload'

import { isAdmin, isManager, isStaff } from '../access/roles'

/** Logos and product images, stored in R2 or Vercel Blob. Resized client-side; no `sharp`. */
export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    group: 'Catalogue',
  },
  access: {
    read: isStaff,
    create: isManager,
    update: isManager,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
  },
}
