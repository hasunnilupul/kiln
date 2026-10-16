'use client'

import { Button } from '@payloadcms/ui'
import React, { createContext, useContext, useId } from 'react'

import { getAt, pathKey, type DraftPath } from '../../lib/draft-path'

export interface DraftContextValue {
  draft: unknown
  update: (path: DraftPath, value: unknown) => void
  /** Issue messages by dotted path, e.g. `outlets.0.code`. */
  issues: Map<string, string[]>
  disabled: boolean
}

export const DraftContext = createContext<DraftContextValue | null>(null)

function useDraft(): DraftContextValue {
  const value = useContext(DraftContext)
  if (!value) throw new Error('Wizard fields must be inside DraftContext')
  return value
}

const fieldStyle: React.CSSProperties = { marginBottom: 'var(--base)', flex: '1 1 220px' }
const errorStyle: React.CSSProperties = {
  color: 'var(--theme-error-500)',
  fontSize: 13,
  marginTop: 4,
}

function Issues({ path }: { path: DraftPath }) {
  const messages = useDraft().issues.get(pathKey(path))
  if (!messages?.length) return null
  return (
    <div role="alert" style={errorStyle}>
      {messages.join('; ')}
    </div>
  )
}

/** Field-level issues for a whole section or list, e.g. "an enabled cash method is required". */
export function SectionIssues({ path }: { path: DraftPath }) {
  return <Issues path={path} />
}

interface InputProps {
  path: DraftPath
  label: string
  description?: string
  /** Suggestions shown while typing, e.g. currency codes. */
  options?: readonly string[]
  readOnly?: boolean
}

/** A text field. Empty optional values are removed from the draft rather than stored as "". */
export function TextField({
  path,
  label,
  description,
  options,
  readOnly,
  optional,
  type = 'text',
}: InputProps & { optional?: boolean; type?: 'text' | 'email' | 'tel' }) {
  const { draft, update, disabled } = useDraft()
  const id = useId()
  const value = getAt(draft, path)
  return (
    <div className="field-type text" style={fieldStyle}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-type__wrap">
        <input
          disabled={disabled}
          id={id}
          list={options ? `${id}-options` : undefined}
          onChange={(event) =>
            update(path, optional && event.target.value === '' ? undefined : event.target.value)
          }
          readOnly={readOnly}
          type={type}
          value={typeof value === 'string' ? value : ''}
        />
        {options ? (
          <datalist id={`${id}-options`}>
            {options.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        ) : null}
      </div>
      {description ? <div className="field-description">{description}</div> : null}
      <Issues path={path} />
    </div>
  )
}

/**
 * The branding logo (BR-11): uploads the file straight away and puts its stored path in the draft;
 * like every other edit, it reaches the client with the next saved config version.
 */
export function LogoField({ endpoint, path }: { endpoint: string; path: DraftPath }) {
  const { draft, update, disabled } = useDraft()
  const id = useId()
  const value = getAt(draft, path)
  const current = typeof value === 'string' ? value : null
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': file.name.replace(/[^\w .()-]/g, ''),
        },
        body: file,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || typeof body.path !== 'string') {
        setError(body.error?.message ?? 'Could not upload the logo')
        return
      }
      update(path, body.path)
    } catch {
      setError('Could not reach the builder')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="field-type upload" style={fieldStyle}>
      <label className="field-label" htmlFor={id}>
        Logo (optional)
      </label>
      {current ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--base)', marginBottom: 8 }}>
          {/* An <img> never runs script, even for an SVG; the endpoint also forbids it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Current logo"
            src={`${endpoint}?path=${encodeURIComponent(current)}`}
            style={{
              maxHeight: 80,
              maxWidth: 240,
              objectFit: 'contain',
              background: 'var(--theme-elevation-50)',
              padding: 8,
            }}
          />
          <code style={{ fontSize: 12 }}>{current}</code>
          <Button
            buttonStyle="secondary"
            disabled={disabled || uploading}
            onClick={() => update(path, undefined)}
            size="small"
          >
            Remove logo
          </Button>
        </div>
      ) : null}
      <input
        accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
        disabled={disabled || uploading}
        id={id}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }}
        style={{ minHeight: 44 }}
        type="file"
      />
      <div className="field-description">
        {uploading
          ? 'Uploading…'
          : 'PNG, JPEG, WebP or SVG, up to 512 KB. Shown on the till, receipts and as the app icon.'}
      </div>
      {error ? (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      ) : null}
      <Issues path={path} />
    </div>
  )
}

/** A number field; an empty box leaves the value unset so validation reports it. */
export function NumberField({ path, label, description }: InputProps) {
  const { draft, update, disabled } = useDraft()
  const id = useId()
  const value = getAt(draft, path)
  return (
    <div className="field-type number" style={fieldStyle}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-type__wrap">
        <input
          disabled={disabled}
          id={id}
          inputMode="decimal"
          onChange={(event) =>
            update(path, event.target.value === '' ? undefined : Number(event.target.value))
          }
          step="any"
          type="number"
          value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
        />
      </div>
      {description ? <div className="field-description">{description}</div> : null}
      <Issues path={path} />
    </div>
  )
}

export function SelectField<T extends string | number>({
  path,
  label,
  choices,
}: {
  path: DraftPath
  label: string
  choices: readonly { value: T; label: string }[]
}) {
  const { draft, update, disabled } = useDraft()
  const id = useId()
  const value = getAt(draft, path)
  return (
    <div className="field-type select" style={fieldStyle}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-type__wrap">
        <select
          disabled={disabled}
          id={id}
          onChange={(event) => {
            const choice = choices.find((c) => String(c.value) === event.target.value)
            update(path, choice?.value)
          }}
          style={{ width: '100%', minHeight: 40 }}
          value={value === undefined ? '' : String(value)}
        >
          {value === undefined ? <option value="">Choose…</option> : null}
          {choices.map((choice) => (
            <option key={String(choice.value)} value={String(choice.value)}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      <Issues path={path} />
    </div>
  )
}

export function CheckboxField({ path, label, description }: InputProps) {
  const { draft, update, disabled } = useDraft()
  const id = useId()
  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <label htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          checked={getAt(draft, path) === true}
          disabled={disabled}
          id={id}
          onChange={(event) => update(path, event.target.checked)}
          style={{ width: 20, height: 20 }}
          type="checkbox"
        />
        {label}
      </label>
      {description ? <div className="field-description">{description}</div> : null}
      <Issues path={path} />
    </div>
  )
}

export function ColorField({ path, label }: InputProps) {
  const { draft, update, disabled } = useDraft()
  const id = useId()
  const value = getAt(draft, path)
  const hex = typeof value === 'string' ? value : ''
  return (
    <div className="field-type text" style={fieldStyle}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-type__wrap" style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label={`${label} picker`}
          disabled={disabled}
          onChange={(event) => update(path, event.target.value.toUpperCase())}
          style={{ width: 48, height: 40, padding: 0 }}
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#000000'}
        />
        <input
          disabled={disabled}
          id={id}
          onChange={(event) => update(path, event.target.value)}
          value={hex}
        />
      </div>
      <Issues path={path} />
    </div>
  )
}

/** Fields side by side, wrapping on narrow screens. */
export function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 var(--base)' }}>{children}</div>
}

/**
 * An editable list: one card per item, with remove buttons and an "Add" button that appends
 * `blank()`. Lists the schema requires to be non-empty keep at least one item.
 */
export function ListField({
  path,
  addLabel,
  blank,
  minItems = 1,
  renderItem,
  title,
}: {
  path: DraftPath
  addLabel: string
  blank: () => unknown
  minItems?: number
  renderItem: (itemPath: DraftPath, index: number) => React.ReactNode
  title: (index: number) => string
}) {
  const { draft, update, disabled } = useDraft()
  const value = getAt(draft, path)
  const items = Array.isArray(value) ? value : []
  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <SectionIssues path={path} />
      {items.map((_, index) => (
        <fieldset
          key={index}
          style={{
            border: '1px solid var(--theme-elevation-150)',
            borderRadius: 4,
            padding: 'var(--base)',
            marginBottom: 'var(--base)',
          }}
        >
          <legend style={{ padding: '0 6px', fontWeight: 600 }}>{title(index)}</legend>
          {renderItem([...path, index], index)}
          {items.length > minItems ? (
            <Button
              buttonStyle="secondary"
              disabled={disabled}
              onClick={() =>
                update(
                  path,
                  items.filter((__, i) => i !== index),
                )
              }
              size="small"
            >
              Remove
            </Button>
          ) : null}
        </fieldset>
      ))}
      <Button
        buttonStyle="secondary"
        disabled={disabled}
        onClick={() => update(path, [...items, blank()])}
        size="small"
      >
        {addLabel}
      </Button>
    </div>
  )
}
