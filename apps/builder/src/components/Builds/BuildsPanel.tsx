'use client'

import { Button } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

export interface BuildRow {
  id: number
  status: 'queued' | 'building' | 'succeeded' | 'failed'
  templateVersion: string
  configNumber: number
  licenceId: string
  createdAt: string
  finishedAt: string | null
  runUrl: string | null
  error: string | null
  zipName: string | null
  size: number | null
  sha256: string | null
  rebuildOf: number | null
  downloads: number
  lastDownloadedAt: string | null
}

interface Props {
  archived: boolean
  /** `/api/builds`, for downloads. */
  buildsEndpoint: string
  configVersions: { version: number; note: string | null }[]
  downloadsReady: boolean
  /** `/api/clients/:id/builds`, for starting builds. */
  endpoint: string
  licence: { licenceId: string; expiresAt: string } | null
  rows: BuildRow[]
  setupProblem: string | null
  templateVersions: string[]
}

const STATUS_LABEL: Record<BuildRow['status'], string> = {
  queued: 'Queued',
  building: 'Building',
  succeeded: 'Succeeded',
  failed: 'Failed',
}

const cell: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  textAlign: 'left',
  verticalAlign: 'top',
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

/** Start builds and follow their progress (BR-20 to BR-22, BR-24). */
export function BuildsPanel({
  archived,
  buildsEndpoint,
  configVersions,
  downloadsReady,
  endpoint,
  licence,
  rows,
  setupProblem,
  templateVersions,
}: Props) {
  const router = useRouter()
  const [configVersion, setConfigVersion] = useState(configVersions[0]?.version ?? 0)
  const [templateVersion, setTemplateVersion] = useState(templateVersions[0] ?? '')
  const [rebuildOf, setRebuildOf] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState<number | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const running = rows.some((row) => row.status === 'queued' || row.status === 'building')
  const blocker = archived
    ? 'This client is archived.'
    : setupProblem
      ? `Builds are not available: ${setupProblem}`
      : configVersions.length === 0
        ? 'Save a config in the Setup wizard first.'
        : !licence
          ? 'Issue or renew a licence on the Licences tab first; every build ships the current licence.'
          : null

  async function start(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configVersion, templateVersion, rebuildOf: rebuildOf ?? undefined }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage({ kind: 'error', text: body.error?.message ?? 'Could not start the build' })
        return
      }
      setRebuildOf(null)
      setMessage({
        kind: 'success',
        text: 'Build queued. GitHub Actions picks it up in a few seconds; refresh to follow it.',
      })
      router.refresh()
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the builder' })
    } finally {
      setBusy(false)
    }
  }

  /** Asks for a fresh 15-minute link (each one is logged) and starts the download with it. */
  async function download(row: BuildRow) {
    setDownloading(row.id)
    setMessage(null)
    try {
      const response = await fetch(`${buildsEndpoint}/${row.id}/download`, {
        method: 'POST',
        credentials: 'include',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || typeof body.url !== 'string') {
        setMessage({
          kind: 'error',
          text: body.error?.message ?? 'Could not create the download link',
        })
        return
      }
      window.location.assign(body.url)
      setMessage({
        kind: 'success',
        text: `Downloading ${body.zipName}. Check it against SHA-256 ${body.sha256} before deploying.`,
      })
      router.refresh()
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the builder' })
    } finally {
      setDownloading(null)
    }
  }

  const rebuild = (row: BuildRow) => {
    setRebuildOf(row.id)
    setConfigVersion(row.configNumber)
    if (templateVersions.includes(row.templateVersion)) setTemplateVersion(row.templateVersion)
    setMessage(null)
    document.getElementById('build-form')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          style={{
            marginBottom: 'var(--base)',
            color: message.kind === 'error' ? 'var(--theme-error-500)' : 'var(--theme-success-500)',
          }}
        >
          {message.text}
        </p>
      ) : null}

      <form
        id="build-form"
        onSubmit={start}
        style={{ maxWidth: 640, marginBottom: 'calc(var(--base) * 2)' }}
      >
        <h3 style={{ marginBottom: 'calc(var(--base) / 2)' }}>
          {rebuildOf ? `Rebuild of build #${rebuildOf}` : 'New build'}
        </h3>
        {blocker ? (
          <p style={{ marginBottom: 'var(--base)' }}>{blocker}</p>
        ) : (
          <>
            <p style={{ marginBottom: 'var(--base)' }}>
              Ships licence <code>{licence!.licenceId}</code>, valid until{' '}
              {new Date(licence!.expiresAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 'var(--base)',
                flexWrap: 'wrap',
                marginBottom: 'var(--base)',
              }}
            >
              <div className="field-type select" style={{ flex: '1 1 200px' }}>
                <label className="field-label" htmlFor="build-config">
                  Config version
                </label>
                <select
                  id="build-config"
                  onChange={(event) => setConfigVersion(Number(event.target.value))}
                  style={{ width: '100%', minHeight: 44 }}
                  value={configVersion}
                >
                  {configVersions.map((config, i) => (
                    <option key={config.version} value={config.version}>
                      c{config.version}
                      {i === 0 ? ' (latest)' : ''}
                      {config.note ? ` – ${config.note}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-type select" style={{ flex: '1 1 200px' }}>
                <label className="field-label" htmlFor="build-template">
                  Template version
                </label>
                <select
                  id="build-template"
                  onChange={(event) => setTemplateVersion(event.target.value)}
                  style={{ width: '100%', minHeight: 44 }}
                  value={templateVersion}
                >
                  {templateVersions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button disabled={busy || Boolean(blocker)} type="submit">
            {busy ? 'Starting…' : rebuildOf ? 'Rebuild' : 'Build'}
          </Button>
          {rebuildOf ? (
            <Button buttonStyle="secondary" onClick={() => setRebuildOf(null)}>
              Cancel rebuild
            </Button>
          ) : null}
          {running ? (
            <Button buttonStyle="secondary" onClick={() => router.refresh()}>
              Refresh status
            </Button>
          ) : null}
        </div>
      </form>

      <h3 style={{ marginBottom: 'var(--base)' }}>Build history</h3>
      {rows.length === 0 ? (
        <p>No builds yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={cell}>Build</th>
                <th style={cell}>Status</th>
                <th style={cell}>Versions</th>
                <th style={cell}>Result</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>
                    #{row.id}
                    <div>{dateTime(row.createdAt)}</div>
                    {row.rebuildOf ? <div>rebuild of #{row.rebuildOf}</div> : null}
                  </td>
                  <td style={cell}>
                    {STATUS_LABEL[row.status]}
                    {row.finishedAt ? <div>{dateTime(row.finishedAt)}</div> : null}
                    {row.runUrl ? (
                      <div>
                        <a href={row.runUrl} rel="noreferrer" target="_blank">
                          Workflow logs
                        </a>
                      </div>
                    ) : null}
                  </td>
                  <td style={cell}>
                    {row.templateVersion} · c{row.configNumber}
                    <div>
                      <code>{row.licenceId}</code>
                    </div>
                  </td>
                  <td style={{ ...cell, wordBreak: 'break-all' }}>
                    {row.status === 'succeeded' ? (
                      <>
                        {row.zipName} ({((row.size ?? 0) / 1024 / 1024).toFixed(1)} MB)
                        <div>
                          SHA-256 <code>{row.sha256}</code>
                        </div>
                        <div>
                          {row.downloads === 0
                            ? 'Not downloaded yet'
                            : `Downloaded ${row.downloads}× · last ${dateTime(row.lastDownloadedAt!)}`}
                        </div>
                      </>
                    ) : (
                      (row.error ?? '')
                    )}
                  </td>
                  <td style={cell}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {row.status === 'succeeded' && downloadsReady ? (
                        <Button
                          disabled={downloading !== null}
                          onClick={() => download(row)}
                          size="small"
                        >
                          {downloading === row.id ? 'Preparing…' : 'Download'}
                        </Button>
                      ) : null}
                      {!blocker && (row.status === 'succeeded' || row.status === 'failed') ? (
                        <Button buttonStyle="secondary" onClick={() => rebuild(row)} size="small">
                          Rebuild
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
