'use client'

import { MODULE_NAMES, type ModuleName } from '@kiln/client-config'
import { Button } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import { LICENCE_TERMS, LICENCE_TERM_IDS, type LicenceTerm } from '../../lib/licence-terms'

export interface LicenceRow {
  id: number
  licenceId: string
  term: LicenceTerm
  status: 'current' | 'expired' | 'superseded' | 'revoked'
  allowedHosts: string[]
  modules: ModuleName[]
  maxRegisters: number
  issuedAt: string
  expiresAt: string
  revokedReason: string | null
  lastCheckInAt: string | null
  lastCheckInHost: string | null
}

interface Props {
  archived: boolean
  defaults: { allowedHosts: string[]; modules: ModuleName[]; maxRegisters: number }
  hasConfig: boolean
  issueEndpoint: string
  licencesApi: string
  rows: LicenceRow[]
}

const STATUS_LABEL: Record<LicenceRow['status'], string> = {
  current: 'Current',
  expired: 'Expired',
  superseded: 'Superseded',
  revoked: 'Revoked',
}

const cell: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  textAlign: 'left',
  verticalAlign: 'top',
}

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' })
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, json }
}

/** Issue, renew, revoke and download licences for one client (BR-30 to BR-32). */
export function LicencesPanel({
  archived,
  defaults,
  hasConfig,
  issueEndpoint,
  licencesApi,
  rows,
}: Props) {
  const router = useRouter()
  const current = rows.find((row) => row.status === 'current' || row.status === 'expired')
  const [term, setTerm] = useState<LicenceTerm>('12m')
  const [hosts, setHosts] = useState(defaults.allowedHosts.join('\n'))
  const [modules, setModules] = useState<ModuleName[]>(defaults.modules)
  const [maxRegisters, setMaxRegisters] = useState(String(defaults.maxRegisters))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [revoking, setRevoking] = useState<number | null>(null)
  const [reason, setReason] = useState('')

  async function issue(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const { ok, json } = await post(issueEndpoint, {
      term,
      allowedHosts: hosts.split(/[\s,]+/).filter(Boolean),
      modules,
      maxRegisters: Number(maxRegisters),
    }).catch(() => ({ ok: false, json: {} as Record<string, never> }))
    setBusy(false)
    if (!ok) {
      const details = json.error?.details?.fieldErrors as Record<string, string[]> | undefined
      const first = details && Object.values(details).flat()[0]
      setMessage({
        kind: 'error',
        text: first ?? json.error?.message ?? 'Could not issue the licence',
      })
      return
    }
    setMessage({
      kind: 'success',
      text: `Issued ${json.licenceId}, valid until ${date(json.expiresAt)}. POS installs pick it up at their next daily check-in.`,
    })
    router.refresh()
  }

  async function revoke(id: number) {
    setBusy(true)
    setMessage(null)
    const { ok, json } = await post(`${licencesApi}/${id}/revoke`, { reason }).catch(() => ({
      ok: false,
      json: {} as Record<string, never>,
    }))
    setBusy(false)
    if (!ok) {
      setMessage({ kind: 'error', text: json.error?.message ?? 'Could not revoke the licence' })
      return
    }
    setRevoking(null)
    setReason('')
    setMessage({
      kind: 'success',
      text: `Revoked ${json.licenceId}. The POS stops at its next check-in (within 24 hours).`,
    })
    router.refresh()
  }

  const toggleModule = (name: ModuleName) =>
    setModules((list) => (list.includes(name) ? list.filter((m) => m !== name) : [...list, name]))

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

      <h3 style={{ marginBottom: 'var(--base)' }}>Licences</h3>
      {rows.length === 0 ? (
        <p style={{ marginBottom: 'var(--base)' }}>No licence issued yet.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 'calc(var(--base) * 2)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={cell}>Licence</th>
                <th style={cell}>Status</th>
                <th style={cell}>Valid</th>
                <th style={cell}>Hosts</th>
                <th style={cell}>Modules · registers</th>
                <th style={cell}>Last check-in</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>
                    <code>{row.licenceId}</code>
                    <div>{LICENCE_TERMS[row.term].label}</div>
                  </td>
                  <td style={cell}>
                    {STATUS_LABEL[row.status]}
                    {row.revokedReason ? <div>{row.revokedReason}</div> : null}
                  </td>
                  <td style={cell}>
                    {date(row.issuedAt)} – {date(row.expiresAt)}
                  </td>
                  <td style={cell}>{row.allowedHosts.join(', ')}</td>
                  <td style={cell}>
                    {row.modules.join(', ') || 'none'} · {row.maxRegisters}
                  </td>
                  <td style={cell}>
                    {row.lastCheckInAt
                      ? `${dateTime(row.lastCheckInAt)}${row.lastCheckInHost ? ` from ${row.lastCheckInHost}` : ''}`
                      : 'Never'}
                  </td>
                  <td style={cell}>
                    <a download href={`${licencesApi}/${row.id}/file`}>
                      Download
                    </a>
                    {row.status !== 'revoked' && !archived ? (
                      revoking === row.id ? (
                        <div style={{ marginTop: 8, display: 'grid', gap: 8, minWidth: 220 }}>
                          <label htmlFor={`reason-${row.id}`}>Reason for revoking</label>
                          <input
                            id={`reason-${row.id}`}
                            maxLength={200}
                            onChange={(event) => setReason(event.target.value)}
                            value={reason}
                          />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <Button
                              buttonStyle="error"
                              disabled={busy || reason.trim() === ''}
                              onClick={() => revoke(row.id)}
                              size="small"
                            >
                              Confirm revoke
                            </Button>
                            <Button
                              buttonStyle="secondary"
                              onClick={() => setRevoking(null)}
                              size="small"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 8 }}>
                          <Button
                            buttonStyle="secondary"
                            onClick={() => setRevoking(row.id)}
                            size="small"
                          >
                            Revoke
                          </Button>
                        </div>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {archived ? (
        <p>This client is archived; no new licences can be issued.</p>
      ) : (
        <form onSubmit={issue} style={{ maxWidth: 640 }}>
          <h3 style={{ marginBottom: 'calc(var(--base) / 2)' }}>
            {current ? 'Renew licence' : 'Issue licence'}
          </h3>
          <p style={{ marginBottom: 'var(--base)' }}>
            {current
              ? `Issuing replaces ${current.licenceId}; POS installs switch to the new licence at their next check-in.`
              : hasConfig
                ? 'Modules and registers start from the latest config; change them to match what the client pays for.'
                : 'No config saved yet; set modules and registers by hand.'}
          </p>

          <fieldset style={{ border: 0, padding: 0, marginBottom: 'var(--base)' }}>
            <legend className="field-label">Term</legend>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {LICENCE_TERM_IDS.map((id) => (
                <label
                  key={id}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 44 }}
                >
                  <input
                    checked={term === id}
                    name="term"
                    onChange={() => setTerm(id)}
                    type="radio"
                  />
                  {LICENCE_TERMS[id].label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field-type textarea" style={{ marginBottom: 'var(--base)' }}>
            <label className="field-label" htmlFor="licence-hosts">
              Allowed hosts
            </label>
            <textarea
              id="licence-hosts"
              onChange={(event) => setHosts(event.target.value)}
              placeholder="pos.acmemart.lk"
              rows={3}
              style={{ width: '100%' }}
              value={hosts}
            />
            <div className="field-description">
              One per line: the host of the client&apos;s PUBLIC_URL, without https:// or a port.
            </div>
          </div>

          <fieldset style={{ border: 0, padding: 0, marginBottom: 'var(--base)' }}>
            <legend className="field-label">Licensed modules</legend>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {MODULE_NAMES.map((name) => (
                <label
                  key={name}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 44 }}
                >
                  <input
                    checked={modules.includes(name)}
                    onChange={() => toggleModule(name)}
                    type="checkbox"
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field-type number" style={{ marginBottom: 'var(--base)', maxWidth: 200 }}>
            <label className="field-label" htmlFor="licence-registers">
              Max registers
            </label>
            <input
              id="licence-registers"
              inputMode="numeric"
              min={1}
              onChange={(event) => setMaxRegisters(event.target.value)}
              type="number"
              value={maxRegisters}
            />
          </div>

          <Button disabled={busy} type="submit">
            {busy ? 'Issuing…' : current ? 'Renew licence' : 'Issue licence'}
          </Button>
        </form>
      )}
    </>
  )
}
