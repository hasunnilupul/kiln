import { s3Storage } from '@payloadcms/storage-s3'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import type { Plugin } from 'payload'
import { z } from 'zod'

import { isProductionRuntime } from './runtime'

export const STORAGE_DRIVERS = ['r2', 'vercel-blob', 'local'] as const

export type StorageSettings =
  | {
      driver: 'r2'
      accountId: string
      accessKeyId: string
      secretAccessKey: string
      bucket: string
    }
  | { driver: 'vercel-blob'; token: string }
  | { driver: 'local' }

const required = z.string().trim().min(1, 'is required')

const r2Env = z.object({
  R2_ACCOUNT_ID: required,
  R2_ACCESS_KEY_ID: required,
  R2_SECRET_ACCESS_KEY: required,
  R2_BUCKET: required,
})

const vercelBlobEnv = z.object({
  BLOB_READ_WRITE_TOKEN: required,
})

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')
}

/**
 * Picks the media storage from `STORAGE_DRIVER` and validates its credentials. `local` (disk)
 * is for development only: a production server must use `r2` or `vercel-blob`.
 */
export function resolveStorage(env: NodeJS.ProcessEnv): StorageSettings {
  const production = isProductionRuntime(env)
  const driver = env.STORAGE_DRIVER?.trim() || (production ? undefined : 'local')

  if (driver === 'r2') {
    const parsed = r2Env.safeParse(env)
    if (!parsed.success) {
      throw new Error(`STORAGE_DRIVER=r2: ${describeIssues(parsed.error)}`)
    }
    return {
      driver,
      accountId: parsed.data.R2_ACCOUNT_ID,
      accessKeyId: parsed.data.R2_ACCESS_KEY_ID,
      secretAccessKey: parsed.data.R2_SECRET_ACCESS_KEY,
      bucket: parsed.data.R2_BUCKET,
    }
  }
  if (driver === 'vercel-blob') {
    const parsed = vercelBlobEnv.safeParse(env)
    if (!parsed.success) {
      throw new Error(`STORAGE_DRIVER=vercel-blob: ${describeIssues(parsed.error)}`)
    }
    return { driver, token: parsed.data.BLOB_READ_WRITE_TOKEN }
  }
  if (driver === 'local' && !production) {
    return { driver }
  }
  throw new Error(
    production
      ? 'STORAGE_DRIVER must be "r2" or "vercel-blob" in production'
      : `STORAGE_DRIVER must be one of ${STORAGE_DRIVERS.join(', ')}`,
  )
}

/**
 * Storage plugins for the `media` collection. Both are always registered with
 * `alwaysInsertFields`, and at most one is enabled, so the database schema is identical whichever
 * driver a client uses (one schema, one migration path). With neither enabled, Payload stores
 * uploads on local disk.
 */
export function storagePlugins(settings: StorageSettings): Plugin[] {
  return [
    s3Storage({
      enabled: settings.driver === 'r2',
      alwaysInsertFields: true,
      collections: { media: true },
      bucket: settings.driver === 'r2' ? settings.bucket : '',
      config:
        settings.driver === 'r2'
          ? {
              credentials: {
                accessKeyId: settings.accessKeyId,
                secretAccessKey: settings.secretAccessKey,
              },
              // Cloudflare R2 requires region "auto" and path-style addressing.
              region: 'auto',
              endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
              forcePathStyle: true,
            }
          : {},
    }),
    vercelBlobStorage({
      enabled: settings.driver === 'vercel-blob',
      alwaysInsertFields: true,
      collections: { media: true },
      token: settings.driver === 'vercel-blob' ? settings.token : '',
    }),
  ]
}
