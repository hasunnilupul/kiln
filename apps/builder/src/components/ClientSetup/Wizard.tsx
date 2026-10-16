'use client'

import {
  DATE_FORMATS,
  PAYMENT_METHOD_TYPES,
  RECEIPT_PAPER_WIDTHS_MM,
  WIZARD_STEPS,
  diffClientConfigs,
  validateDraft,
  type WizardStepId,
} from '@kiln/client-config'
import { Button } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useMemo, useState } from 'react'

import { getAt, pathKey, setAt, type DraftPath } from '../../lib/draft-path'
import { ConfigDiff } from '../ConfigDiff'
import {
  CheckboxField,
  ColorField,
  DraftContext,
  ListField,
  NumberField,
  Row,
  SectionIssues,
  SelectField,
  TextField,
} from './fields'

export interface WizardProps {
  archived: boolean
  clientRecordId: number
  endpoint: string
  initialDraft: unknown
  latest: { version: number; config: unknown } | null
}

interface StoredDraft {
  baseVersion: number | null
  draft: unknown
}

const storageKey = (clientRecordId: number) => `kiln-builder:config-draft:${clientRecordId}`

/** Unsaved wizard work survives a reload in this browser; nothing here is authoritative. */
function readStored(clientRecordId: number): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(clientRecordId))
    return raw ? (JSON.parse(raw) as StoredDraft) : null
  } catch {
    return null
  }
}

function writeStored(clientRecordId: number, value: StoredDraft | null) {
  try {
    if (value) window.localStorage.setItem(storageKey(clientRecordId), JSON.stringify(value))
    else window.localStorage.removeItem(storageKey(clientRecordId))
  } catch {
    // Storage may be blocked (private mode); the draft then lives only in this tab.
  }
}

function supported(kind: 'currency' | 'timeZone'): string[] {
  try {
    return Intl.supportedValuesOf(kind)
  } catch {
    return []
  }
}

const PAYMENT_TYPE_LABELS: Record<(typeof PAYMENT_METHOD_TYPES)[number], string> = {
  cash: 'Cash',
  card_external: 'Card (external terminal)',
  qr: 'QR payment',
  other: 'Other',
}

const MODULE_DESCRIPTIONS = {
  inventory: 'Stock levels, stock movements and adjustments.',
  customers: 'Customer records attached to sales.',
  discounts: 'Line and sale discounts, with manager approval above the limit.',
  multiOutlet: 'More than one outlet. Required for a second outlet.',
} as const

/**
 * The setup wizard (BR-11). The draft lives in the browser; each step shows only its own
 * validation issues, and Review saves the whole config as a new version (BR-12), which the
 * server validates again.
 */
export function Wizard({ archived, clientRecordId, endpoint, initialDraft, latest }: WizardProps) {
  const router = useRouter()
  const baseVersion = latest?.version ?? null
  // Unsaved work is restored only if it was based on the version shown now.
  const [start] = useState(() => {
    const stored = readStored(clientRecordId)
    return stored && stored.baseVersion === baseVersion
      ? {
          draft: stored.draft,
          restored: JSON.stringify(stored.draft) !== JSON.stringify(initialDraft),
        }
      : { draft: initialDraft, restored: false }
  })
  const [draft, setDraft] = useState<unknown>(start.draft)
  const [step, setStep] = useState<WizardStepId>('business')
  const [restored, setRestored] = useState(start.restored)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [serverIssues, setServerIssues] = useState<
    { path: (string | number)[]; message: string }[]
  >([])
  const validation = useMemo(() => validateDraft(draft), [draft])
  const issues = useMemo(() => {
    const byPath = new Map<string, string[]>()
    for (const issue of validation.issues) {
      const key = pathKey(issue.path)
      byPath.set(key, [...(byPath.get(key) ?? []), issue.message])
    }
    return byPath
  }, [validation])
  const issueCount = (id: WizardStepId) => validation.issues.filter((i) => i.step === id).length
  const changes = useMemo(
    () => diffClientConfigs(latest?.config ?? {}, validation.valid ? validation.config : draft),
    [draft, latest, validation],
  )

  const update = (path: DraftPath, value: unknown) => {
    setDraft((current: unknown) => {
      const next = setAt(current, path, value)
      writeStored(clientRecordId, { baseVersion, draft: next })
      return next
    })
    setMessage(null)
  }

  const discard = () => {
    writeStored(clientRecordId, null)
    setDraft(initialDraft)
    setRestored(false)
    setServerIssues([])
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    setServerIssues([])
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: draft, note: note.trim() || undefined }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setServerIssues(body.error?.details?.issues ?? [])
        setMessage({ kind: 'error', text: body.error?.message ?? 'Could not save the config' })
        return
      }
      writeStored(clientRecordId, null)
      setNote('')
      setMessage({
        kind: 'success',
        text: body.created
          ? `Saved as version c${body.version}.`
          : `No changes since c${body.version}; nothing saved.`,
      })
      router.refresh()
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the builder' })
    } finally {
      setSaving(false)
    }
  }

  const index = WIZARD_STEPS.findIndex((s) => s.id === step)
  const current = WIZARD_STEPS[index]!
  const disabled = archived || saving

  return (
    <DraftContext.Provider value={{ draft, update, issues, disabled }}>
      {archived ? (
        <p role="status" style={{ marginBottom: 'var(--base)' }}>
          This client is archived. Its config can be viewed but not changed.
        </p>
      ) : null}
      {restored ? (
        <p role="status" style={{ marginBottom: 'var(--base)' }}>
          Restored unsaved changes from this browser.{' '}
          <button
            className="btn--style-none"
            onClick={discard}
            type="button"
            style={{ textDecoration: 'underline' }}
          >
            Discard them
          </button>
        </p>
      ) : null}

      <nav aria-label="Setup steps" style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
        <ol
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {WIZARD_STEPS.map((s, i) => {
            const count = issueCount(s.id)
            return (
              <li key={s.id}>
                <Button
                  aria-current={s.id === step ? 'step' : undefined}
                  buttonStyle={s.id === step ? 'primary' : 'secondary'}
                  onClick={() => setStep(s.id)}
                  size="small"
                >
                  {`${i + 1}. ${s.label}${count && s.id !== 'review' ? ` (${count})` : ''}`}
                </Button>
              </li>
            )
          })}
        </ol>
      </nav>

      <h2 style={{ marginBottom: 'var(--base)' }}>{current.label}</h2>
      <StepBody
        changes={changes}
        issueSteps={validation.issues}
        latestVersion={latest?.version ?? null}
        note={note}
        onGoTo={setStep}
        setNote={setNote}
        serverIssues={serverIssues}
        step={step}
      />

      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          style={{
            margin: 'var(--base) 0',
            color: message.kind === 'error' ? 'var(--theme-error-500)' : 'var(--theme-success-500)',
          }}
        >
          {message.text}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--base)' }}>
        <Button
          buttonStyle="secondary"
          disabled={index === 0}
          onClick={() => setStep(WIZARD_STEPS[index - 1]!.id)}
        >
          Back
        </Button>
        {step === 'review' ? (
          <Button disabled={disabled || !validation.valid || changes.length === 0} onClick={save}>
            {saving ? 'Saving…' : `Save as version c${(latest?.version ?? 0) + 1}`}
          </Button>
        ) : (
          <Button onClick={() => setStep(WIZARD_STEPS[index + 1]!.id)}>Next</Button>
        )}
      </div>
    </DraftContext.Provider>
  )
}

function StepBody({
  changes,
  issueSteps,
  latestVersion,
  note,
  onGoTo,
  serverIssues,
  setNote,
  step,
}: {
  changes: ReturnType<typeof diffClientConfigs>
  issueSteps: { step: WizardStepId; path: (string | number)[]; message: string }[]
  latestVersion: number | null
  note: string
  onGoTo: (step: WizardStepId) => void
  serverIssues: { path: (string | number)[]; message: string }[]
  setNote: (note: string) => void
  step: WizardStepId
}) {
  const currencies = useMemo(() => supported('currency'), [])
  const timeZones = useMemo(() => supported('timeZone'), [])

  switch (step) {
    case 'business':
      return (
        <>
          <Row>
            <TextField label="Legal name" path={['client', 'legalName']} />
            <TextField
              label="Display name"
              path={['client', 'displayName']}
              description="Shown on the till and receipts."
            />
          </Row>
          <TextField label="Address" optional path={['client', 'address']} />
          <Row>
            <TextField label="Phone" optional path={['client', 'phone']} type="tel" />
            <TextField label="Email" optional path={['client', 'email']} type="email" />
            <TextField
              label="Tax registration number"
              optional
              path={['client', 'taxRegistrationNo']}
            />
          </Row>
          <Row>
            <TextField
              label="Client ID"
              path={['client', 'id']}
              readOnly
              description="From the client record."
            />
            <TextField
              label="Slug"
              path={['client', 'slug']}
              readOnly
              description="Edit it on the client record."
            />
          </Row>
        </>
      )
    case 'locale':
      return (
        <Row>
          <TextField
            label="Currency"
            options={currencies}
            path={['locale', 'currency']}
            description="ISO 4217, e.g. LKR."
          />
          <TextField label="Locale" path={['locale', 'locale']} description="BCP 47, e.g. en-LK." />
          <TextField
            label="Time zone"
            options={timeZones}
            path={['locale', 'timezone']}
            description="IANA, e.g. Asia/Colombo."
          />
          <SelectField
            choices={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
            label="Date format"
            path={['locale', 'dateFormat']}
          />
        </Row>
      )
    case 'branding':
      return (
        <>
          <Row>
            <ColorField label="Primary colour" path={['branding', 'primaryColor']} />
            <ColorField label="Accent colour" path={['branding', 'accentColor']} />
          </Row>
          <TextField label="Receipt header" optional path={['branding', 'receiptHeader']} />
          <TextField label="Receipt footer" optional path={['branding', 'receiptFooter']} />
          <p className="field-description">Logo upload arrives with build storage.</p>
        </>
      )
    case 'tax':
      return <TaxStep />
    case 'payments':
      return (
        <ListField
          addLabel="Add payment method"
          blank={() => ({
            code: '',
            label: '',
            type: 'other',
            enabled: true,
            requiresReference: false,
          })}
          path={['paymentMethods']}
          renderItem={(item) => (
            <>
              <Row>
                <TextField
                  label="Code"
                  path={[...item, 'code']}
                  description="Lower case, e.g. card."
                />
                <TextField label="Label" path={[...item, 'label']} />
                <SelectField
                  choices={PAYMENT_METHOD_TYPES.map((type) => ({
                    value: type,
                    label: PAYMENT_TYPE_LABELS[type],
                  }))}
                  label="Type"
                  path={[...item, 'type']}
                />
              </Row>
              <Row>
                <CheckboxField label="Enabled" path={[...item, 'enabled']} />
                <CheckboxField
                  label="Requires a reference (e.g. card slip number)"
                  path={[...item, 'requiresReference']}
                />
              </Row>
            </>
          )}
          title={(i) => `Payment method ${i + 1}`}
        />
      )
    case 'outlets':
      return (
        <ListField
          addLabel="Add outlet"
          blank={() => ({ code: '', name: '', registers: [{ code: '', name: '' }] })}
          path={['outlets']}
          renderItem={(outlet) => (
            <>
              <Row>
                <TextField
                  label="Code"
                  path={[...outlet, 'code']}
                  description="Upper case, e.g. MAIN."
                />
                <TextField label="Name" path={[...outlet, 'name']} />
              </Row>
              <TextField label="Address" optional path={[...outlet, 'address']} />
              <ListField
                addLabel="Add register"
                blank={() => ({ code: '', name: '' })}
                path={[...outlet, 'registers']}
                renderItem={(register) => (
                  <Row>
                    <TextField
                      label="Code"
                      path={[...register, 'code']}
                      description="Unique across outlets, e.g. R2."
                    />
                    <TextField label="Name" path={[...register, 'name']} />
                  </Row>
                )}
                title={(i) => `Register ${i + 1}`}
              />
            </>
          )}
          title={(i) => `Outlet ${i + 1}`}
        />
      )
    case 'modules':
      return (
        <>
          {(Object.keys(MODULE_DESCRIPTIONS) as (keyof typeof MODULE_DESCRIPTIONS)[]).map(
            (name) => (
              <CheckboxField
                description={MODULE_DESCRIPTIONS[name]}
                key={name}
                label={name}
                path={['modules', name]}
              />
            ),
          )}
          <p className="field-description">
            Modules only hide features; every client gets the same database schema. The licence
            decides which enabled modules actually work.
          </p>
        </>
      )
    case 'receipt':
      return (
        <>
          <SelectField
            choices={RECEIPT_PAPER_WIDTHS_MM.map((width) => ({
              value: width,
              label: `${width} mm`,
            }))}
            label="Paper width"
            path={['receipt', 'paperWidthMm']}
          />
          <CheckboxField label="Show tax breakdown" path={['receipt', 'showTaxBreakdown']} />
          <CheckboxField label="Show cashier name" path={['receipt', 'showCashierName']} />
        </>
      )
    case 'admin':
      return (
        <>
          <p style={{ marginBottom: 'var(--base)' }}>
            The POS creates this admin on first boot. Their initial password comes from the
            client&apos;s <code>.env</code> and must be changed on first sign-in; it is never stored
            here.
          </p>
          <Row>
            <TextField label="Name" path={['admin', 'name']} />
            <TextField label="Email" path={['admin', 'email']} type="email" />
          </Row>
        </>
      )
    case 'review':
      return (
        <Review
          changes={changes}
          issueSteps={issueSteps}
          latestVersion={latestVersion}
          note={note}
          onGoTo={onGoTo}
          serverIssues={serverIssues}
          setNote={setNote}
        />
      )
  }
}

function TaxStep() {
  const { draft } = React.useContext(DraftContext)!
  const rates = getAt(draft, ['tax', 'rates'])
  const codes = Array.isArray(rates)
    ? rates
        .map((rate) => (rate as { code?: unknown }).code)
        .filter((code): code is string => typeof code === 'string' && code !== '')
    : []
  return (
    <>
      <CheckboxField
        description="On: shelf prices already include tax. Off: tax is added at the till."
        label="Prices include tax"
        path={['tax', 'pricesIncludeTax']}
      />
      <ListField
        addLabel="Add tax rate"
        blank={() => ({ code: '', name: '', ratePercent: 0 })}
        path={['tax', 'rates']}
        renderItem={(rate) => (
          <Row>
            <TextField label="Code" path={[...rate, 'code']} description="Upper case, e.g. STD." />
            <TextField label="Name" path={[...rate, 'name']} />
            <NumberField
              label="Rate (%)"
              path={[...rate, 'ratePercent']}
              description="Up to 4 decimal places."
            />
          </Row>
        )}
        title={(i) => `Tax rate ${i + 1}`}
      />
      <SelectField
        choices={codes.map((code) => ({ value: code, label: code }))}
        label="Default tax rate"
        path={['tax', 'defaultRateCode']}
      />
    </>
  )
}

function Review({
  changes,
  issueSteps,
  latestVersion,
  note,
  onGoTo,
  serverIssues,
  setNote,
}: {
  changes: ReturnType<typeof diffClientConfigs>
  issueSteps: { step: WizardStepId; path: (string | number)[]; message: string }[]
  latestVersion: number | null
  note: string
  onGoTo: (step: WizardStepId) => void
  serverIssues: { path: (string | number)[]; message: string }[]
  setNote: (note: string) => void
}) {
  const { disabled } = React.useContext(DraftContext)!
  const all = [
    ...issueSteps,
    ...serverIssues.map((issue) => ({ ...issue, step: 'review' as const })),
  ]
  return (
    <>
      <SectionIssues path={[]} />
      {all.length > 0 ? (
        <div role="alert" style={{ marginBottom: 'var(--base)' }}>
          <p>Fix these before saving:</p>
          <ul>
            {all.map((issue, i) => {
              const label = WIZARD_STEPS.find((s) => s.id === issue.step)?.label
              return (
                <li key={i}>
                  {issue.step !== 'review' ? (
                    <button
                      className="btn--style-none"
                      onClick={() => onGoTo(issue.step)}
                      style={{ textDecoration: 'underline' }}
                      type="button"
                    >
                      {label}
                    </button>
                  ) : (
                    label
                  )}
                  {': '}
                  <code>{issue.path.join('.') || 'config'}</code> — {issue.message}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p style={{ marginBottom: 'var(--base)' }}>The config is valid.</p>
      )}

      <h3 style={{ marginBottom: 'var(--base)' }}>
        {latestVersion ? `Changes since c${latestVersion}` : 'New config'}
      </h3>
      <ConfigDiff changes={changes} empty={`No changes since c${latestVersion}.`} />

      <div className="field-type text" style={{ marginTop: 'calc(var(--base) * 1.5)' }}>
        <label className="field-label" htmlFor="config-note">
          Note for this version (optional)
        </label>
        <div className="field-type__wrap">
          <input
            disabled={disabled}
            id="config-note"
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </div>
      </div>
    </>
  )
}
