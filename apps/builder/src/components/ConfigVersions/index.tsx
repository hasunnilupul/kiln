import { diffClientConfigs } from '@kiln/client-config'
import type { DocumentViewServerProps } from 'payload'
import React from 'react'

import type { User } from '../../payload-types'
import { ConfigDiff } from '../ConfigDiff'

const cell: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  textAlign: 'left',
}

function pick(value: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(value) ? value[0] : value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * The "Config versions" tab of a client: every saved version, and the diff between two of them
 * (BR-13). Defaults to the latest version against the one before it.
 */
export async function ConfigVersionsView({
  doc,
  initPageResult,
  searchParams,
}: DocumentViewServerProps) {
  const { req } = initPageResult
  if (!req.user || !doc?.id) return null

  const { docs: versions } = await req.payload.find({
    collection: 'client-configs',
    where: { client: { equals: doc.id } },
    sort: '-version',
    pagination: false,
    depth: 1,
    overrideAccess: true,
    req,
  })
  const base = `${req.payload.config.routes.admin}/collections/clients/${doc.id}/configs`

  if (versions.length === 0) {
    return (
      <div className="gutter--left gutter--right" style={{ paddingBlock: 'var(--base)' }}>
        <p>No config saved yet. Use the Setup wizard tab to create version 1.</p>
      </div>
    )
  }

  const byNumber = new Map(versions.map((version) => [version.version, version]))
  const to = byNumber.get(pick(searchParams?.to) ?? versions[0]!.version) ?? versions[0]!
  const from = byNumber.get(pick(searchParams?.from) ?? to.version - 1)

  return (
    <div className="gutter--left gutter--right" style={{ paddingBlock: 'var(--base)' }}>
      <h3 style={{ marginBottom: 'var(--base)' }}>
        {from ? `Changes from c${from.version} to c${to.version}` : `Version c${to.version}`}
      </h3>
      <ConfigDiff
        changes={
          from ? diffClientConfigs(from.config, to.config) : diffClientConfigs({}, to.config)
        }
        empty="These versions are identical."
      />

      <h3 style={{ marginBlock: 'calc(var(--base) * 2) var(--base)' }}>All versions</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={cell}>Version</th>
            <th style={cell}>Saved</th>
            <th style={cell}>By</th>
            <th style={cell}>Note</th>
            <th style={cell}>Compare</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.id}>
              <td style={cell}>c{version.version}</td>
              <td style={cell}>{new Date(version.createdAt).toLocaleString('en-GB')}</td>
              <td style={cell}>{(version.createdBy as User | null)?.email ?? '—'}</td>
              <td style={cell}>{version.note ?? ''}</td>
              <td style={cell}>
                {version.version > 1 ? (
                  <a href={`${base}?from=${version.version - 1}&to=${version.version}`}>
                    vs c{version.version - 1}
                  </a>
                ) : null}
                {version.version !== versions[0]!.version ? (
                  <>
                    {' · '}
                    <a href={`${base}?from=${version.version}&to=${versions[0]!.version}`}>
                      vs latest
                    </a>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
