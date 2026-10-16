'use client'

import { Button } from '@payloadcms/ui'
import React, { useState } from 'react'

interface Enrolment {
  token: string
  secret: string
  qr: string
}

interface Props {
  endpoint: string
  redirectTo: string
}

type Step = { kind: 'credentials' } | { kind: 'code' } | { kind: 'enrol'; enrolment: Enrolment }

const fieldStyle: React.CSSProperties = { marginBottom: 'var(--base)' }

function Field({
  autoComplete,
  autoFocus,
  id,
  inputMode,
  label,
  maxLength,
  onChange,
  type = 'text',
  value,
}: {
  autoComplete: string
  autoFocus?: boolean
  id: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  label: string
  maxLength?: number
  onChange: (value: string) => void
  type?: string
  value: string
}) {
  return (
    <div className="field-type text" style={fieldStyle}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-type__wrap">
        <input
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          id={id}
          inputMode={inputMode}
          maxLength={maxLength}
          name={id}
          onChange={(event) => onChange(event.target.value)}
          required
          type={type}
          value={value}
        />
      </div>
    </div>
  )
}

/**
 * Two steps: email and password first; only once they are accepted does the form ask for the
 * authenticator code (or, on the very first sign-in, walk the owner through enrolment). The
 * password stays in memory between the steps and is sent again with the code.
 */
export function SignInForm({ endpoint, redirectTo }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'credentials' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const startOver = () => {
    setStep({ kind: 'credentials' })
    setPassword('')
    setCode('')
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          code: step.kind === 'credentials' ? '' : code,
          enrolToken: step.kind === 'enrol' ? step.enrolment.token : undefined,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.codeRequired) {
        setStep({ kind: 'code' })
        setCode('')
        return
      }
      if (response.ok && body.enrol) {
        setStep({ kind: 'enrol', enrolment: body.enrol })
        setCode('')
        return
      }
      if (response.ok) {
        // A full load, so the admin panel starts with the new session cookie.
        window.location.assign(redirectTo)
        return
      }
      const errorCode = body.error?.code
      if (errorCode === 'enrolment_expired') {
        startOver()
      } else if (step.kind !== 'credentials' && errorCode === 'invalid_credentials') {
        setError('That code was not accepted. Wait for a new code and try again.')
        setCode('')
        return
      }
      setError(body.error?.message ?? 'Sign-in failed')
    } catch {
      setError('Could not reach the builder')
    } finally {
      setBusy(false)
    }
  }

  const errorMessage = error ? (
    <p role="alert" style={{ color: 'var(--theme-error-500)', marginBottom: 'var(--base)' }}>
      {error}
    </p>
  ) : null

  if (step.kind === 'credentials') {
    return (
      <form onSubmit={submit}>
        <Field
          autoComplete="username"
          autoFocus
          id="email"
          label="Email"
          onChange={setEmail}
          type="email"
          value={email}
        />
        <Field
          autoComplete="current-password"
          id="password"
          label="Password"
          onChange={setPassword}
          type="password"
          value={password}
        />
        {errorMessage}
        <Button buttonStyle="primary" disabled={busy} size="large" type="submit">
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={submit}>
      {step.kind === 'enrol' ? (
        <div style={fieldStyle}>
          <h2 style={{ marginBottom: 'var(--base)' }}>Set up two-factor sign-in</h2>
          <p>Scan this code with an authenticator app, then enter the six-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimisable image */}
          <img
            alt="Authenticator set-up QR code"
            height={240}
            src={step.enrolment.qr}
            width={240}
          />
          <p>
            Or enter this key by hand:{' '}
            <code style={{ wordBreak: 'break-all' }}>{step.enrolment.secret}</code>
          </p>
        </div>
      ) : (
        <div style={fieldStyle}>
          <h2 style={{ marginBottom: 'calc(var(--base) / 2)' }}>Two-factor sign-in</h2>
          <p>Enter the six-digit code from your authenticator app for {email}.</p>
        </div>
      )}
      <Field
        autoComplete="one-time-code"
        autoFocus
        id="code"
        inputMode="numeric"
        label="Authenticator code"
        maxLength={8}
        onChange={setCode}
        value={code}
      />
      {errorMessage}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          buttonStyle="primary"
          disabled={busy || code.trim() === ''}
          size="large"
          type="submit"
        >
          {step.kind === 'enrol' ? 'Finish set-up and sign in' : 'Verify and sign in'}
        </Button>
        <Button buttonStyle="secondary" disabled={busy} onClick={startOver} size="large">
          Use a different account
        </Button>
      </div>
    </form>
  )
}
