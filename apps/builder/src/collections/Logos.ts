import type { CollectionConfig } from 'payload'

import { isOwner, nobody } from '../access/owner'

/**
 * Branding logos uploaded in the setup wizard (BR-11), kept in the builder's own database: they
 * are small, and storing them with the configs keeps every config version buildable without
 * write access to the build bucket. Append-only and content-addressed per client, so a saved
 * config always finds the exact logo it points at. Only the logo endpoints write here.
 */
export const Logos: CollectionConfig = {
  slug: 'logos',
  admin: {
    useAsTitle: 'path',
    defaultColumns: ['path', 'client', 'filename', 'size', 'createdAt'],
    hidden: true,
  },
  defaultSort: '-createdAt',
  access: {
    read: isOwner,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  indexes: [{ fields: ['client', 'path'], unique: true }],
  fields: [
    { name: 'client', type: 'relationship', relationTo: 'clients', required: true, index: true },
    // What the config's `branding.logo` holds, e.g. `assets/logo-3f2a9c1b7d4e.png`.
    { name: 'path', type: 'text', required: true },
    { name: 'filename', type: 'text', admin: { description: 'Name of the uploaded file.' } },
    { name: 'mimeType', type: 'text', required: true },
    { name: 'size', type: 'number', required: true },
    { name: 'sha256', type: 'text', required: true },
    // The file itself, base64. Hidden from API reads; the endpoints ask for it explicitly.
    { name: 'data', type: 'textarea', required: true, hidden: true },
    { name: 'uploadedBy', type: 'relationship', relationTo: 'users' },
  ],
}
