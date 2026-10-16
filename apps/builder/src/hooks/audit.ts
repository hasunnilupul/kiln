import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'

import { clientIp } from '../lib/client-ip'

/** Never written to the audit log. */
const SECRET_KEYS = new Set([
  'password',
  'hash',
  'salt',
  'totpSecret',
  'totpLastStep',
  'resetPasswordToken',
  'resetPasswordExpiration',
  'sessions',
  'loginAttempts',
  'lockUntil',
])
/** Change on every save, so they say nothing. */
const NOISE_KEYS = new Set(['updatedAt', 'createdAt'])

type Doc = Record<string, unknown>

/** Top-level fields whose value changed, as `{ field: { from, to } }`, without secrets. */
export function changedFields(previous: Doc | undefined, next: Doc | undefined): Doc {
  const changes: Doc = {}
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])
  for (const key of keys) {
    if (SECRET_KEYS.has(key) || NOISE_KEYS.has(key)) continue
    const from = previous?.[key]
    const to = next?.[key]
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = { from: from ?? null, to: to ?? null }
    }
  }
  return changes
}

export interface AuditEntry {
  action: string
  entity: string
  entityId?: string | number
  data?: Doc
  /** Defaults to the signed-in user. */
  actor?: number | null
}

/**
 * Writes an `audit-log` entry (BR-04) inside the request's transaction, with the caller's IP.
 * Hooks here audit every collection change; endpoints audit sign-ins, builds and downloads.
 */
export async function writeAudit(req: PayloadRequest, entry: AuditEntry): Promise<void> {
  await req.payload.create({
    collection: 'audit-log',
    data: {
      actor:
        entry.actor !== undefined
          ? entry.actor
          : req.user?.collection === 'users'
            ? req.user.id
            : null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId === undefined ? undefined : String(entry.entityId),
      ip: req.headers ? clientIp(req.headers) : null,
      data: entry.data ?? {},
    },
    overrideAccess: true,
    req,
  })
}

export const auditCollectionChange: CollectionAfterChangeHook = async ({
  collection,
  doc,
  operation,
  previousDoc,
  req,
}) => {
  const changes = changedFields(operation === 'create' ? undefined : previousDoc, doc)
  if (Object.keys(changes).length > 0) {
    await writeAudit(req, {
      action: operation,
      entity: collection.slug,
      entityId: doc.id,
      data: changes,
    })
  }
  return doc
}

export const auditCollectionDelete: CollectionAfterDeleteHook = async ({
  collection,
  doc,
  id,
  req,
}) => {
  await writeAudit(req, {
    action: 'delete',
    entity: collection.slug,
    entityId: id,
    data: changedFields(doc, undefined),
  })
  return doc
}
