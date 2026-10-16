import type { ConfigChange } from '@kiln/client-config'
import React from 'react'

function show(value: unknown): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const KIND_LABEL: Record<ConfigChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
}

const cell: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  verticalAlign: 'top',
  wordBreak: 'break-word',
}

/** A table of config changes (BR-13). Renders on the server or the client. */
export function ConfigDiff({ changes, empty }: { changes: ConfigChange[]; empty: string }) {
  if (changes.length === 0) return <p>{empty}</p>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left' }}>
          <th style={cell}>Field</th>
          <th style={cell}>Change</th>
          <th style={cell}>Before</th>
          <th style={cell}>After</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => (
          <tr key={`${change.kind}:${change.path}`}>
            <td style={cell}>
              <code>{change.path || '(whole config)'}</code>
            </td>
            <td style={cell}>{KIND_LABEL[change.kind]}</td>
            <td style={{ ...cell, color: 'var(--theme-error-500)' }}>{show(change.from)}</td>
            <td style={{ ...cell, color: 'var(--theme-success-500)' }}>{show(change.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
