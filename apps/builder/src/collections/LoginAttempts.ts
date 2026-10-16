import type { CollectionConfig } from 'payload'

import { nobody } from '../access/owner'

/**
 * Failed sign-ins, counted per IP and per account for the rate limit (BR-02). Kept in the
 * database rather than memory so the limit holds across serverless instances. Server code only.
 */
export const LoginAttempts: CollectionConfig = {
  slug: 'login-attempts',
  admin: { hidden: true },
  access: {
    read: nobody,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    { name: 'ip', type: 'text', index: true },
    { name: 'email', type: 'text', index: true },
  ],
  indexes: [{ fields: ['createdAt'] }],
}
