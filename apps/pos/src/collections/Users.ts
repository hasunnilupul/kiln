import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'

// Roles and outlet scoping (FR-10, FR-11) arrive in M2.
export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  access: {
    admin: ({ req: { user } }) => Boolean(user),
    create: authenticated,
    read: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  auth: true,
  fields: [],
}
