import type { CollectionConfig } from 'payload'

import { isOwner, nobodyField } from '../access/owner'
import { auditCollectionChange, auditCollectionDelete } from '../hooks/audit'
import { blockUnverifiedAuth, checkTotpOnLogin } from '../hooks/totp-login'
import { MAX_PASSWORD_FAILURES, PASSWORD_LOCK_MS } from '../lib/login-limit'

/**
 * Platform owners (BR-01). Signing in needs password and TOTP code, and goes only through
 * `POST /api/auth/sign-in`; Payload's own login, forgot-password and reset-password are refused.
 * Owners are seeded from the environment on first boot; there is no self-signup.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'totpEnabled'],
    group: 'System',
  },
  auth: {
    tokenExpiration: 8 * 60 * 60,
    // Locks the account after repeated wrong passwords, on top of the 15-minute rate limit (BR-02).
    maxLoginAttempts: MAX_PASSWORD_FAILURES,
    lockTime: PASSWORD_LOCK_MS,
    cookies: { sameSite: 'Strict', secure: process.env.NODE_ENV === 'production' },
  },
  access: {
    admin: ({ req: { user } }) => Boolean(user && user.collection === 'users'),
    create: isOwner,
    read: isOwner,
    update: isOwner,
    // Owners delete other owners, never themselves, so the builder always keeps one.
    delete: ({ req: { user } }) =>
      user && user.collection === 'users' ? { id: { not_equals: user.id } } : false,
    unlock: isOwner,
  },
  hooks: {
    beforeOperation: [blockUnverifiedAuth],
    beforeLogin: [checkTotpOnLogin],
    afterChange: [auditCollectionChange],
    afterDelete: [auditCollectionDelete],
  },
  fields: [
    { name: 'name', type: 'text' },
    {
      // Set only by the sign-in flow; true once an authenticator app is enrolled.
      name: 'totpEnabled',
      type: 'checkbox',
      defaultValue: false,
      access: { create: nobodyField, update: nobodyField },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Set up on first sign-in with an authenticator app.',
      },
    },
    {
      // AES-GCM sealed with PAYLOAD_SECRET (lib/secrets.ts); never exposed.
      name: 'totpSecret',
      type: 'text',
      hidden: true,
      access: { create: nobodyField, read: nobodyField, update: nobodyField },
    },
    {
      // Time step of the last accepted code, so a code is never accepted twice.
      name: 'totpLastStep',
      type: 'number',
      hidden: true,
      access: { create: nobodyField, read: nobodyField, update: nobodyField },
    },
  ],
}
