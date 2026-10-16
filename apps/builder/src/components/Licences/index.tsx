import { MODULE_NAMES, type ClientConfig, type ModuleName } from '@kiln/client-config'
import type { DocumentViewServerProps, PayloadRequest } from 'payload'
import React from 'react'

import type { Client, Licence } from '../../payload-types'
import { LicencesPanel, type LicenceRow } from './LicencesPanel'

function statusOf(licence: Licence, now: number): LicenceRow['status'] {
  if (licence.revokedAt) return 'revoked'
  if (licence.supersededBy) return 'superseded'
  if (Date.parse(licence.expiresAt) <= now) return 'expired'
  return 'current'
}

/**
 * The "Licences" tab of a client (BR-30 to BR-32): issued licences with their state and last
 * POS check-in, and a form to issue or renew. The form starts from the current licence, or for
 * a first licence from the latest config's modules and register count.
 */
export async function LicencesView({ doc, initPageResult }: DocumentViewServerProps) {
  const { req } = initPageResult
  if (!req.user || !doc?.id) return null
  const client = doc as Client
  const { rows, config } = await loadLicences(req, client)

  const current = rows.find((row) => row.status === 'current' || row.status === 'expired')
  const defaults = current
    ? {
        allowedHosts: current.allowedHosts,
        modules: current.modules,
        maxRegisters: current.maxRegisters,
      }
    : {
        allowedHosts: [],
        modules: config ? MODULE_NAMES.filter((name) => config.modules[name]) : [],
        maxRegisters: config
          ? config.outlets.reduce((sum, outlet) => sum + outlet.registers.length, 0)
          : 1,
      }

  const api = req.payload.config.routes.api
  return (
    <div className="gutter--left gutter--right" style={{ paddingBlock: 'var(--base)' }}>
      <LicencesPanel
        archived={client.status === 'archived'}
        defaults={defaults}
        hasConfig={Boolean(config)}
        issueEndpoint={`${api}/clients/${client.id}/licences`}
        licencesApi={`${api}/licences`}
        rows={rows}
      />
    </div>
  )
}

/** The client's licences with their state as of now, and its latest config. */
async function loadLicences(
  req: PayloadRequest,
  client: Client,
): Promise<{ rows: LicenceRow[]; config: ClientConfig | undefined }> {
  const now = Date.now()
  const [{ docs: licences }, { docs: configs }] = await Promise.all([
    req.payload.find({
      collection: 'licences',
      where: { client: { equals: client.id } },
      sort: '-issuedAt',
      pagination: false,
      depth: 0,
      overrideAccess: true,
      req,
    }),
    req.payload.find({
      collection: 'client-configs',
      where: { client: { equals: client.id } },
      sort: '-version',
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    }),
  ])

  const rows: LicenceRow[] = licences.map((licence) => ({
    id: licence.id,
    licenceId: licence.licenceId,
    term: licence.term,
    status: statusOf(licence, now),
    allowedHosts: licence.allowedHosts ?? [],
    modules: (licence.modules ?? []) as ModuleName[],
    maxRegisters: licence.maxRegisters,
    issuedAt: licence.issuedAt,
    expiresAt: licence.expiresAt,
    revokedReason: licence.revokedReason ?? null,
    lastCheckInAt: licence.lastCheckInAt ?? null,
    lastCheckInHost: licence.lastCheckInHost ?? null,
  }))
  return { rows, config: configs[0]?.config as ClientConfig | undefined }
}
