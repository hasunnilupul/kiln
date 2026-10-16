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

const fieldStyle: React.CSSProperties = { marginBottom: 'var(--base)' }

function Field({
  autoComplete,
  id,
  inputMode,
  label,
  onChange,
  type = 'text',
  value,
}: {
  autoComplete: string
  id: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  label: string
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
          id={id}
          inputMode={inputMode}
          name={id}
          onChange={(event) => onChange(event.target.value)}
          required={id !== 'code'}
          type={type}
          value={value}
        />
      </div>
    </div>
  )
}

/** Signs in with password and TOTP, or walks a first-time owner through authenticator set-up. */
export function SignInForm({ endpoint, redirectTo }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, code, enrolToken: enrolment?.token }),
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.enrol) {
        setEnrolment(body.enrol)
        setCode('')
        return
      }
      if (response.ok) {
        // A full load, so the admin panel starts with the new session cookie.
        window.location.assign(redirectTo)
        return
      }
      if (body.error?.code === 'enrolment_expired') setEnrolment(null)
      setError(body.error?.message ?? 'Sign-in failed')
    } catch {
      setError('Could not reach the builder')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      {enrolment ? (
        <div style={fieldStyle}>
          <p>
            Set up two-factor sign-in: scan this code with an authenticator app, then enter the
            six-digit code it shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimisable image */}
          <img alt="Authenticator set-up QR code" height={240} src={enrolment.qr} width={240} />
          <p>
            Or enter this key by hand:{' '}
            <code style={{ wordBreak: 'break-all' }}>{enrolment.secret}</code>
          </p>
        </div>
      ) : (
        <>
          <Field
            autoComplete="username"
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
        </>
      )}
      <Field
        autoComplete="one-time-code"
        id="code"
        inputMode="numeric"
        label={
          enrolment ? 'Code from your app' : 'Authenticator code (leave empty on first sign-in)'
        }
        onChange={setCode}
        value={code}
      />
      {error ? (
        <p role="alert" style={{ color: 'var(--theme-error-500)', marginBottom: 'var(--base)' }}>
          {error}
        </p>
      ) : null}
      <Button buttonStyle="primary" disabled={busy} size="large" type="submit">
        {enrolment ? 'Finish set-up and sign in' : 'Sign in'}
      </Button>
    </form>
  )
}
