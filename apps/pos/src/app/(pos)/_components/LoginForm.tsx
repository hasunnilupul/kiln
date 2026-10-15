'use client'

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { setActing } from '../_lib/api'

/** Full sign-in that starts a session on this device (FR-12). */
export function LoginForm({ title }: { title: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    const response = await fetch('/api/users/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    })
    setBusy(false)
    if (!response.ok) {
      setError(
        response.status === 423
          ? 'Account locked. Try again later.'
          : 'Email or password not accepted.',
      )
      return
    }
    setActing(null)
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl bg-background p-6 shadow"
      >
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-11"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          Sign in
        </Button>
      </form>
    </main>
  )
}
