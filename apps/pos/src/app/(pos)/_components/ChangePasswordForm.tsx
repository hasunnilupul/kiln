'use client'

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const MIN_LENGTH = 12

/** Replaces a temporary password before the till can be used (FR-03). */
export function ChangePasswordForm({ userId, name }: { userId: number; name: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`)
    if (password !== form.get('confirm')) return setError('The passwords do not match.')
    setBusy(true)
    const response = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setBusy(false)
    if (!response.ok) return setError('The password could not be changed.')
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl bg-background p-6 shadow"
      >
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          {name}, you signed in with a temporary password. Choose your own to continue.
        </p>
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Repeat it</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
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
          Save password
        </Button>
      </form>
    </main>
  )
}
