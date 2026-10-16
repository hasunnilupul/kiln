import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * The builder's access to client build zips in the private R2 bucket (BR-23). The workflow uploads
 * them; the builder only checks they arrived and hands out short-lived signed download links, so
 * its R2 token needs read access only.
 */

export interface R2Settings {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export const R2_VARIABLES = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const

/** How long a download link works (BR-23). */
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60

/** Settings from the `R2_*` variables; callers check they are all set first. */
export function r2Settings(env: NodeJS.ProcessEnv = process.env): R2Settings {
  return {
    accountId: env.R2_ACCOUNT_ID!.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
    bucket: env.R2_BUCKET!.trim(),
  }
}

function client(settings: R2Settings): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  })
}

/** A signed GET link for `key` that saves the file as `filename` and expires after 15 minutes. */
export async function signedDownloadUrl(
  settings: R2Settings,
  key: string,
  filename: string,
  expiresIn: number = DOWNLOAD_URL_TTL_SECONDS,
): Promise<string> {
  return getSignedUrl(
    client(settings),
    new GetObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\\r\n]/g, '')}"`,
    }),
    { expiresIn },
  )
}

/**
 * The size of the object at `key`, or null when it does not exist. Uses a signed HEAD link through
 * `fetch`, so it needs nothing beyond what downloads need.
 */
export async function objectSize(
  settings: R2Settings,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const url = await getSignedUrl(
    client(settings),
    new HeadObjectCommand({ Bucket: settings.bucket, Key: key }),
    { expiresIn: 60 },
  )
  const response = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`R2 HEAD ${key} failed: ${response.status}`)
  const length = Number(response.headers.get('content-length'))
  if (!Number.isSafeInteger(length)) throw new Error(`R2 HEAD ${key} gave no size`)
  return length
}
