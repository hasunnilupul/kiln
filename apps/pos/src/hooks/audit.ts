import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
  PayloadRequest,
} from 'payload'

/** Never written to the audit log. */
const SECRET_KEYS = new Set([
  'password',
  'hash',
  'salt',
  'pinHash',
  'resetPasswordToken',
  'resetPasswordExpiration',
  'sessions',
  'loginAttempts',
  'lockUntil',
])
/** Change on every save, so they say nothing. */
const NOISE_KEYS = new Set(['updatedAt', 'createdAt', 'globalType'])

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

/**
 * Writes an `audit-log` entry inside the request's transaction. Used by hooks here and by
 * endpoints for approvals and stock adjustments.
 */
export async function writeAudit(
  req: PayloadRequest,
  entry: { action: string; entity: string; entityId?: string | number; data?: Doc },
): Promise<void> {
  await req.payload.create({
    collection: 'audit-log',
    data: {
      actor: req.user?.collection === 'users' ? req.user.id : null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId === undefined ? undefined : String(entry.entityId),
      data: entry.data ?? {},
    },
    overrideAccess: true,
    req,
  })
}

/** Audits creates and updates of a settings-like collection. */
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

/** Audits settings changes on a global (FR-80). */
export const auditGlobalChange: GlobalAfterChangeHook = async ({
  doc,
  global,
  previousDoc,
  req,
}) => {
  const changes = changedFields(previousDoc, doc)
  if (Object.keys(changes).length > 0) {
    await writeAudit(req, { action: 'update', entity: global.slug, data: changes })
  }
  return doc
}
