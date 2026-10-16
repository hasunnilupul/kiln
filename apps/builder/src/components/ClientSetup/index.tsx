import { newClientConfig } from '@kiln/client-config'
import type { DocumentViewServerProps } from 'payload'
import React from 'react'

import type { Client } from '../../payload-types'
import { SetupWizard } from './SetupWizard'

/**
 * The "Setup wizard" tab of a client (BR-11). Starts from the latest saved version, or from a
 * starter config for a new client; saving creates the next version (BR-12).
 */
export async function ClientSetupView({ doc, initPageResult }: DocumentViewServerProps) {
  const { req } = initPageResult
  if (!req.user || !doc?.id) return null
  const client = doc as Client

  const { docs } = await req.payload.find({
    collection: 'client-configs',
    where: { client: { equals: client.id } },
    sort: '-version',
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const latest = docs[0]
  const identity = { id: client.clientId ?? '', slug: client.slug }
  const start = (latest?.config ?? newClientConfig({ ...identity, displayName: client.name })) as {
    client?: Record<string, unknown>
  }
  // The server always writes the record's id and slug into the config; show the same here.
  const initialDraft = { ...start, client: { ...start.client, ...identity } }

  return (
    <div className="gutter--left gutter--right" style={{ paddingBlock: 'var(--base)' }}>
      <SetupWizard
        archived={client.status === 'archived'}
        clientRecordId={client.id}
        endpoint={`${req.payload.config.routes.api}/clients/${client.id}/configs`}
        initialDraft={initialDraft}
        latest={latest ? { version: latest.version, config: latest.config } : null}
        logoEndpoint={`${req.payload.config.routes.api}/clients/${client.id}/logo`}
      />
    </div>
  )
}
