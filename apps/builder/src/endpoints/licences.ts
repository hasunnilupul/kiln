import { MODULE_NAMES } from '@kiln/client-config'
import { licenceFileSchema, type LicenceFile, type LicenceStatus } from '@kiln/licence'
import { serializeLicence, signLicence, signLicenceStatus } from '@kiln/licence/sign'
import { readSignedLicence } from '@kiln/licence/verify'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { writeAudit } from '../hooks/audit'
import { execute, sql } from '../lib/db'
import { licenceKeys } from '../lib/licence-key'
import { LICENCE_TERM_IDS, licenceExpiry, newLicenceId } from '../lib/licence-terms'
import type { Licence } from '../payload-types'
import { ApiError, inTransaction, jsonEndpoint, requireOwner, routeId } from './http'

const issueBody = z.object({
  term: z.enum(LICENCE_TERM_IDS),
  allowedHosts: z
    .array(z.string().trim().toLowerCase().min(1))
    .min(1, 'Add at least one host')
    .transform((hosts) => [...new Set(hosts)]),
  modules: z.array(z.enum(MODULE_NAMES)).transform((modules) => [...new Set(modules)]),
  maxRegisters: z.int().min(1).max(1000),
})

const relId = (value: number | { id: number } | null | undefined) =>
  value === null || value === undefined ? null : typeof value === 'object' ? value.id : value

/**
 * `POST /api/clients/:id/licences`: issue a licence (BR-30), signed with the builder's key
 * (BR-31). Renewing is issuing again: every earlier licence of the client is marked superseded
 * by the new one, and POS check-ins pick the new one up (BR-32), including a POS whose licence
 * was revoked or has expired.
 */
export const issueLicence = jsonEndpoint({
  method: 'post',
  path: '/:id/licences',
  body: issueBody,
  status: 201,
  handler: async (req, body) => {
    const owner = requireOwner(req)
    const clientId = routeId(req)
    const keys = licenceKeys()

    return inTransaction(req, async () => {
      // One issue at a time per client, so two renewals cannot both stay current.
      const locked = await execute(
        req,
        sql`select id from clients where id = ${clientId} for update`,
      )
      if (locked.length !== 1) throw new ApiError(404, 'client_not_found', 'Client not found')
      const client = await req.payload.findByID({
        collection: 'clients',
        id: clientId,
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (client.status === 'archived') {
        throw new ApiError(409, 'client_archived', 'This client is archived')
      }
      if (!client.clientId) throw new ApiError(409, 'client_without_id', 'Client has no client ID')

      const issuedAt = new Date()
      const payload = {
        version: 1 as const,
        licenceId: newLicenceId(),
        clientId: client.clientId,
        allowedHosts: body.allowedHosts,
        modules: body.modules,
        maxRegisters: body.maxRegisters,
        issuedAt: issuedAt.toISOString(),
        expiresAt: licenceExpiry(issuedAt, body.term).toISOString(),
      }
      // Validates hostnames and dates with the shared schema before anything is stored.
      const file = signLicence(payload, keys.privateKeyPem)

      const licence = await req.payload.create({
        collection: 'licences',
        data: {
          client: clientId,
          licenceId: payload.licenceId,
          term: body.term,
          allowedHosts: payload.allowedHosts,
          modules: payload.modules,
          maxRegisters: payload.maxRegisters,
          issuedAt: payload.issuedAt,
          expiresAt: payload.expiresAt,
          issuedBy: owner.id,
          file,
        },
        overrideAccess: true,
        req,
      })

      const previous = await req.payload.update({
        collection: 'licences',
        where: {
          and: [
            { client: { equals: clientId } },
            { id: { not_equals: licence.id } },
            // Revoked licences too: a POS stopped by a revocation picks up the new licence.
            { supersededBy: { exists: false } },
          ],
        },
        data: { supersededBy: licence.id },
        overrideAccess: true,
        req,
      })

      await writeAudit(req, {
        action: 'issue_licence',
        entity: 'clients',
        entityId: clientId,
        data: {
          licenceId: payload.licenceId,
          term: body.term,
          expiresAt: payload.expiresAt,
          allowedHosts: payload.allowedHosts,
          modules: payload.modules,
          maxRegisters: payload.maxRegisters,
          supersedes: previous.docs.map((doc) => doc.licenceId),
        },
      })
      return { id: licence.id, licenceId: payload.licenceId, expiresAt: payload.expiresAt }
    })
  },
})

/**
 * `POST /api/licences/:id/revoke`: revoke a licence (BR-32). A POS using it, or any licence it
 * superseded, stops at its next check-in.
 */
export const revokeLicence = jsonEndpoint({
  method: 'post',
  path: '/:id/revoke',
  body: z.object({ reason: z.string().trim().min(1, 'Give a reason').max(200) }),
  handler: async (req, body) => {
    const owner = requireOwner(req)
    const id = routeId(req)
    return inTransaction(req, async () => {
      const licence = await findLicence(req, id)
      if (licence.revokedAt) throw new ApiError(409, 'already_revoked', 'Already revoked')
      const revokedAt = new Date().toISOString()
      await req.payload.update({
        collection: 'licences',
        id,
        data: { revokedAt, revokedReason: body.reason, revokedBy: owner.id },
        overrideAccess: true,
        req,
      })
      await writeAudit(req, {
        action: 'revoke_licence',
        entity: 'clients',
        entityId: relId(licence.client) ?? undefined,
        data: { licenceId: licence.licenceId, reason: body.reason },
      })
      return { licenceId: licence.licenceId, revokedAt }
    })
  },
})

/** `GET /api/licences/:id/file`: download `licence.json`, e.g. to renew a POS by hand. Audited. */
export const downloadLicence = jsonEndpoint({
  method: 'get',
  path: '/:id/file',
  handler: async (req) => {
    requireOwner(req)
    const licence = await findLicence(req, routeId(req))
    await writeAudit(req, {
      action: 'download_licence',
      entity: 'clients',
      entityId: relId(licence.client) ?? undefined,
      data: { licenceId: licence.licenceId },
    })
    return new Response(serializeLicence(licenceFileSchema.parse(licence.file)), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="licence-${licence.licenceId}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  },
})

async function findLicence(req: PayloadRequest, id: number): Promise<Licence> {
  const licence = await req.payload
    .findByID({ collection: 'licences', id, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  if (!licence) throw new ApiError(404, 'licence_not_found', 'Licence not found')
  return licence
}

/**
 * What a POS holding `licence` should do now, judged by the newest licence in its renewal chain:
 * stop if that one is revoked, switch to it if it is newer, otherwise carry on.
 */
export async function resolveLicenceStatus(
  req: PayloadRequest,
  licence: Licence,
): Promise<{ status: LicenceStatus['status']; licence?: LicenceFile }> {
  let newest = licence
  // Renewal chains are short; the bound only guards against a corrupted loop.
  for (let hops = 0; hops < 100 && newest.supersededBy; hops += 1) {
    newest = await findLicence(req, relId(newest.supersededBy)!)
  }
  if (newest.revokedAt) return { status: 'revoked' }
  if (newest.id === licence.id) return { status: 'active' }
  return { status: 'superseded', licence: licenceFileSchema.parse(newest.file) }
}

const checkInBody = z.object({
  licence: z.unknown(),
  /** The host the POS serves, from its PUBLIC_URL; recorded for the owner, not trusted. */
  host: z.string().max(253).optional(),
})

/**
 * `POST /api/licence-check`: daily POS check-in (BR-32). Public, since a POS has no builder
 * account: the licence it sends, signed by this builder, is its credential. Answers with a
 * signed status the POS verifies with its embedded public key; it is the only route the IP
 * allowlist lets through.
 */
export const licenceCheck = jsonEndpoint({
  method: 'post',
  path: '/licence-check',
  body: checkInBody,
  handler: async (req, body) => {
    const keys = licenceKeys()
    const presented = readSignedLicence(body.licence, keys.publicKeyPem)
    if (!presented.valid) throw new ApiError(400, 'invalid_licence', presented.message)

    const { docs } = await req.payload.find({
      collection: 'licences',
      where: { licenceId: { equals: presented.licence.licenceId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const record = docs[0]
    if (!record) throw new ApiError(404, 'unknown_licence', 'This licence was not issued here')

    const resolved = await resolveLicenceStatus(req, record)
    await req.payload.update({
      collection: 'licences',
      id: record.id,
      data: { lastCheckInAt: new Date().toISOString(), lastCheckInHost: body.host ?? null },
      overrideAccess: true,
      req,
    })

    const status = signLicenceStatus(
      {
        type: 'licence-status',
        version: 1,
        licenceId: record.licenceId,
        status: resolved.status,
        checkedAt: new Date().toISOString(),
        licence: resolved.licence,
      },
      keys.privateKeyPem,
    )
    return { status }
  },
})
