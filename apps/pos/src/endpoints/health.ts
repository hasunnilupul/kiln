import { sql } from '@payloadcms/db-postgres'
import type { Endpoint } from 'payload'

import { getLicenceState } from '../lib/licence'

/**
 * `GET /api/health`: app, database and licence status for monitoring.
 * Access: public by design. It reveals no business data, only status and the licence expiry.
 */
export const health: Endpoint = {
  path: '/health',
  method: 'get',
  handler: async (req) => {
    let database: 'ok' | 'error' = 'ok'
    try {
      await req.payload.db.drizzle.execute(sql`select 1`)
    } catch {
      database = 'error'
    }

    const state = getLicenceState()
    const licence =
      state?.status === 'valid'
        ? { status: 'valid', expiresAt: state.licence.expiresAt, checkedAt: state.checkedAt }
        : state?.status === 'invalid'
          ? { status: 'invalid', reason: state.reason, checkedAt: state.checkedAt }
          : { status: state?.status ?? 'unchecked' }

    const healthy = database === 'ok' && licence.status !== 'invalid'
    return Response.json({ app: 'ok', database, licence }, { status: healthy ? 200 : 503 })
  },
}
