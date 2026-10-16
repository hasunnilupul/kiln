import type { DocumentViewServerProps, PayloadRequest } from 'payload'
import React from 'react'

import { buildSetup, expireStaleBuilds } from '../../endpoints/builds'
import { currentLicence } from '../../endpoints/licences'
import { listTemplateVersions } from '../../lib/github'
import { R2_VARIABLES } from '../../lib/r2'
import type { Client } from '../../payload-types'
import { BuildsPanel, type BuildRow } from './BuildsPanel'

/**
 * The "Builds" tab of a client (BR-20 to BR-22, BR-24): start a build of any config version on a
 * template version, and follow every build's status, results and workflow logs.
 */
export async function BuildsView({ doc, initPageResult }: DocumentViewServerProps) {
  const { req } = initPageResult
  if (!req.user || !doc?.id) return null
  const client = doc as Client
  const data = await loadBuilds(req, client)

  return (
    <div className="gutter--left gutter--right" style={{ paddingBlock: 'var(--base)' }}>
      <BuildsPanel
        {...data}
        archived={client.status === 'archived'}
        buildsEndpoint={`${req.payload.config.routes.api}/builds`}
        endpoint={`${req.payload.config.routes.api}/clients/${client.id}/builds`}
      />
    </div>
  )
}

async function loadBuilds(req: PayloadRequest, client: Client) {
  await expireStaleBuilds(req, client.id)
  const [{ docs: builds }, { docs: configs }, licence] = await Promise.all([
    req.payload.find({
      collection: 'builds',
      where: { client: { equals: client.id } },
      sort: '-createdAt',
      limit: 50,
      depth: 0,
      overrideAccess: true,
      req,
    }),
    req.payload.find({
      collection: 'client-configs',
      where: { client: { equals: client.id } },
      sort: '-version',
      pagination: false,
      depth: 0,
      select: { version: true, note: true },
      overrideAccess: true,
      req,
    }),
    currentLicence(req, client.id),
  ])

  // Builds need GitHub and the builder's public URL; without them the tab explains what is missing.
  let templateVersions: string[] = []
  let setupProblem: string | null = null
  try {
    templateVersions = await listTemplateVersions(buildSetup().github)
    if (templateVersions.length === 0)
      setupProblem = 'The template repository has no version tags yet.'
  } catch (error) {
    setupProblem = (error as Error).message
  }

  // Every download link handed out is in the audit log (BR-23); show how often and when last.
  const { docs: downloads } =
    builds.length === 0
      ? { docs: [] }
      : await req.payload.find({
          collection: 'audit-log',
          where: {
            and: [
              { action: { equals: 'download_build' } },
              { entity: { equals: 'builds' } },
              { entityId: { in: builds.map((build) => String(build.id)) } },
            ],
          },
          sort: '-createdAt',
          pagination: false,
          depth: 0,
          select: { entityId: true, createdAt: true },
          overrideAccess: true,
          req,
        })
  const downloadsOf = (id: number) => downloads.filter((entry) => entry.entityId === String(id))

  const rows: BuildRow[] = builds.map((build) => ({
    id: build.id,
    status: build.status,
    templateVersion: build.templateVersion,
    configNumber: build.configNumber,
    licenceId: build.licenceId,
    createdAt: build.createdAt,
    finishedAt: build.finishedAt ?? null,
    runUrl: build.runUrl ?? null,
    error: build.error ?? null,
    zipName: build.zipName ?? null,
    size: build.size ?? null,
    sha256: build.sha256 ?? null,
    rebuildOf:
      typeof build.rebuildOf === 'object'
        ? (build.rebuildOf?.id ?? null)
        : (build.rebuildOf ?? null),
    downloads: downloadsOf(build.id).length,
    lastDownloadedAt: downloadsOf(build.id)[0]?.createdAt ?? null,
  }))

  return {
    rows,
    configVersions: configs.map((config) => ({
      version: config.version,
      note: config.note ?? null,
    })),
    templateVersions,
    setupProblem,
    downloadsReady: R2_VARIABLES.every((name) => process.env[name]?.trim()),
    licence: licence ? { licenceId: licence.licenceId, expiresAt: licence.expiresAt } : null,
  }
}
