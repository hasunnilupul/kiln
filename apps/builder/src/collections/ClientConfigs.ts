import type { CollectionConfig } from 'payload'

import { isOwner, nobody } from '../access/owner'

/**
 * Immutable config versions (BR-12): version N of a client's validated `client.config.json`.
 * Created only by `POST /api/clients/:id/configs`, which validates with the shared schema and
 * numbers versions; never edited or deleted, so every build can be traced to its exact config.
 */
export const ClientConfigs: CollectionConfig = {
  slug: 'client-configs',
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['client', 'version', 'note', 'createdBy', 'createdAt'],
    hidden: true,
  },
  defaultSort: '-createdAt',
  access: {
    read: isOwner,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    { name: 'client', type: 'relationship', relationTo: 'clients', required: true, index: true },
    { name: 'version', type: 'number', required: true, min: 1 },
    { name: 'label', type: 'text', admin: { description: 'e.g. "acme-mart c3".' } },
    { name: 'config', type: 'json', required: true },
    { name: 'note', type: 'text' },
    { name: 'createdBy', type: 'relationship', relationTo: 'users' },
  ],
  indexes: [{ fields: ['client', 'version'], unique: true }],
}
