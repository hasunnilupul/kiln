import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

export { sql }

type SQL = ReturnType<typeof sql>

/** Runs raw SQL inside the transaction on `req`, e.g. atomic conditional updates. */
export async function execute<Row extends Record<string, unknown>>(
  req: PayloadRequest,
  query: SQL,
): Promise<Row[]> {
  const id = await req.transactionID
  const adapter = req.payload.db as unknown as PostgresAdapter
  const session = id ? adapter.sessions[id] : undefined
  if (!session) {
    throw new Error('execute() must run inside a transaction')
  }
  const result = await session.db.execute(query)
  return (result as unknown as { rows: Row[] }).rows
}
