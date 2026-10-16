import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { sql } from '@payloadcms/db-postgres'
import { commitTransaction, initTransaction, killTransaction, type PayloadRequest } from 'payload'

export { sql }

type SQL = ReturnType<typeof sql>

/**
 * Runs `fn` in one database transaction carried on `req`, so every Local API call made with `req`
 * joins it (CLAUDE.md: Sales integrity). Rolls back on any error. Nested calls join the outer
 * transaction and leave committing or rolling back to its owner.
 */
export async function inTransaction<T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> {
  const owner = await initTransaction(req)
  try {
    const result = await fn()
    if (owner) await commitTransaction(req)
    return result
  } catch (error) {
    if (owner) await killTransaction(req)
    throw error
  }
}

/** Runs raw SQL inside the request's transaction, e.g. row locks and atomic counters. */
export async function execute<Row extends Record<string, unknown>>(
  req: PayloadRequest,
  query: SQL,
): Promise<Row[]> {
  const id = await req.transactionID
  const adapter = req.payload.db as unknown as PostgresAdapter
  const session = id ? adapter.sessions[id] : undefined
  if (!session) {
    throw new Error('execute() must run inside inTransaction()')
  }
  const result = await session.db.execute(query)
  return (result as unknown as { rows: Row[] }).rows
}

/** Locks one row until the transaction ends, so concurrent requests on it run one at a time. */
export async function lockRow(req: PayloadRequest, table: string, id: number): Promise<boolean> {
  const rows = await execute(
    req,
    sql`select id from ${sql.identifier(table)} where id = ${id} for update`,
  )
  return rows.length === 1
}
