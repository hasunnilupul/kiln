import { describe, expect, it } from 'vitest'

import { resolveStorage, storagePlugins } from '@/lib/storage'

const r2 = {
  STORAGE_DRIVER: 'r2',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'media',
}

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv

describe('resolveStorage', () => {
  it('reads R2 credentials', () => {
    expect(resolveStorage(env({ ...r2, NODE_ENV: 'production' }))).toEqual({
      driver: 'r2',
      accountId: 'acct',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'media',
    })
  })

  it('names every missing R2 variable', () => {
    expect(() => resolveStorage(env({ STORAGE_DRIVER: 'r2', R2_BUCKET: 'media' }))).toThrow(
      /R2_ACCOUNT_ID.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY/,
    )
  })

  it('reads the Vercel Blob token', () => {
    expect(
      resolveStorage(
        env({
          STORAGE_DRIVER: 'vercel-blob',
          BLOB_READ_WRITE_TOKEN: 'tok',
          NODE_ENV: 'production',
        }),
      ),
    ).toEqual({ driver: 'vercel-blob', token: 'tok' })
    expect(() => resolveStorage(env({ STORAGE_DRIVER: 'vercel-blob' }))).toThrow(
      /BLOB_READ_WRITE_TOKEN/,
    )
  })

  it('defaults to local disk in development', () => {
    expect(resolveStorage(env({ NODE_ENV: 'development' }))).toEqual({ driver: 'local' })
    expect(resolveStorage(env({ STORAGE_DRIVER: 'local' }))).toEqual({ driver: 'local' })
  })

  it('refuses local disk or no driver on a production server', () => {
    expect(() => resolveStorage(env({ NODE_ENV: 'production' }))).toThrow(/r2.*vercel-blob/)
    expect(() => resolveStorage(env({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' }))).toThrow(
      /r2.*vercel-blob/,
    )
  })

  it('lets `next build` run without storage credentials', () => {
    expect(
      resolveStorage(env({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' })),
    ).toEqual({ driver: 'local' })
  })

  it('rejects unknown drivers', () => {
    expect(() => resolveStorage(env({ STORAGE_DRIVER: 's3' }))).toThrow(/r2, vercel-blob, local/)
  })
})

describe('storagePlugins', () => {
  it('always registers both adapters so the schema never depends on the driver', () => {
    expect(storagePlugins({ driver: 'local' })).toHaveLength(2)
    expect(storagePlugins(resolveStorage(env(r2)))).toHaveLength(2)
  })
})
