import type { Endpoint, PayloadRequest } from 'payload'

import { writeAudit } from '../hooks/audit'
import { InvalidLogo, LOGO_PATH_PATTERN, MAX_LOGO_BYTES, describeLogo } from '../lib/logo'
import type { Logo } from '../payload-types'
import { ApiError, jsonEndpoint, requireOwner, routeId } from './http'

/** The client's logo stored under `path`, with its bytes, or null. */
export async function findLogo(
  req: PayloadRequest,
  clientId: number,
  path: string,
): Promise<(Logo & { bytes: Buffer }) | null> {
  if (!LOGO_PATH_PATTERN.test(path)) return null
  const { docs } = await req.payload.find({
    collection: 'logos',
    where: { and: [{ client: { equals: clientId } }, { path: { equals: path } }] },
    limit: 1,
    depth: 0,
    showHiddenFields: true,
    overrideAccess: true,
    req,
  })
  const logo = docs[0]
  return logo ? { ...logo, bytes: Buffer.from(logo.data, 'base64') } : null
}

async function readUpload(req: PayloadRequest): Promise<Buffer> {
  const declared = Number(req.headers.get('content-length'))
  if (declared > MAX_LOGO_BYTES) {
    throw new ApiError(
      413,
      'logo_too_large',
      `The logo must be at most ${MAX_LOGO_BYTES / 1024} KB`,
    )
  }
  if (typeof req.arrayBuffer !== 'function') {
    throw new ApiError(400, 'invalid_request', 'Send the image as the request body')
  }
  return Buffer.from(await req.arrayBuffer())
}

/**
 * `POST /api/clients/:id/logo`: the image file as the raw request body, its name in
 * `X-File-Name`. Stores it once per client (the same image again returns the same path) and
 * returns the path for the config's `branding.logo` (BR-11). The config change is saved with the
 * next config version, like any other wizard edit.
 */
export const uploadLogo = jsonEndpoint({
  method: 'post',
  path: '/:id/logo',
  status: 201,
  handler: async (req) => {
    const owner = requireOwner(req)
    const clientId = routeId(req)
    const client = await req.payload
      .findByID({ collection: 'clients', id: clientId, depth: 0, overrideAccess: true, req })
      .catch(() => null)
    if (!client) throw new ApiError(404, 'client_not_found', 'Client not found')
    if (client.status === 'archived') {
      throw new ApiError(409, 'client_archived', 'This client is archived')
    }

    const bytes = await readUpload(req)
    let logo: ReturnType<typeof describeLogo>
    try {
      logo = describeLogo(bytes)
    } catch (error) {
      if (error instanceof InvalidLogo) throw new ApiError(400, 'invalid_logo', error.message)
      throw error
    }

    const existing = await findLogo(req, clientId, logo.path)
    if (!existing) {
      const filename = (req.headers.get('x-file-name') ?? '')
        .replace(/[^\w .()-]/g, '')
        .slice(0, 200)
      await req.payload.create({
        collection: 'logos',
        data: {
          client: clientId,
          path: logo.path,
          filename: filename || undefined,
          mimeType: logo.mimeType,
          size: logo.size,
          sha256: logo.sha256,
          data: bytes.toString('base64'),
          uploadedBy: owner.id,
        },
        overrideAccess: true,
        req,
      })
      await writeAudit(req, {
        action: 'upload_logo',
        entity: 'clients',
        entityId: clientId,
        data: { path: logo.path, filename, size: logo.size, sha256: logo.sha256 },
      })
    }
    return { path: logo.path, size: logo.size, mimeType: logo.mimeType }
  },
})

/**
 * `GET /api/clients/:id/logo?path=assets/logo-….png`: the stored image, for the wizard's preview.
 * Owner only; served so that even an SVG opened directly cannot run anything.
 */
export const serveLogo: Endpoint = {
  method: 'get',
  path: '/:id/logo',
  handler: async (req) => {
    try {
      requireOwner(req)
      const path = new URL(req.url ?? '', 'http://builder').searchParams.get('path') ?? ''
      const logo = await findLogo(req, routeId(req), path)
      if (!logo) return Response.json({ error: { code: 'logo_not_found' } }, { status: 404 })
      return new Response(new Uint8Array(logo.bytes), {
        headers: {
          'Content-Type': logo.mimeType,
          'Content-Length': String(logo.bytes.length),
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'X-Content-Type-Options': 'nosniff',
          // Content-addressed: a path always holds the same image.
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        )
      }
      throw error
    }
  },
}
