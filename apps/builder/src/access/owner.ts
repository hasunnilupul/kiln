import type { Access, FieldAccess } from 'payload'

/**
 * Every builder user is a platform owner (BR-01): signed in with password and TOTP. There are no
 * other roles, and nothing in the builder is public.
 */
export const isOwner: Access = ({ req: { user } }) => Boolean(user && user.collection === 'users')

export const nobody: Access = () => false
export const nobodyField: FieldAccess = () => false
