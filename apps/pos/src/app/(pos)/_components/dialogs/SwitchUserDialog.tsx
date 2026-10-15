'use client'

import React, { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { api, getActing, setActing } from '../../_lib/api'
import type { StaffMember, TillUser } from '../../_lib/types'
import { ErrorText, Modal, message } from './Modal'

/** A colleague takes over the till with their PIN; the device stays signed in (FR-12). */
export function SwitchUserDialog({
  deviceUser,
  onClose,
  onSwitched,
}: {
  deviceUser: TillUser
  onClose: () => void
  onSwitched: () => void
}) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [userId, setUserId] = useState<number | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ staff: StaffMember[] }>('/api/pos/staff')
      .then((r) => setStaff(r.staff))
      .catch((err) => setError(message(err)))
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (userId === null) return
    try {
      setActing(null)
      const result = await api<{ token: string; user: TillUser }>('/api/pos/switch-user', {
        body: { userId, pin },
      })
      if (result.user.id !== deviceUser.id) setActing(result)
      onSwitched()
    } catch (err) {
      setError(message(err))
      setPin('')
    }
  }

  const acting = getActing()

  return (
    <Modal title="Switch user" description="Choose your name and enter your PIN." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
          {staff.map((s) => (
            <Button
              key={s.id}
              type="button"
              variant={s.id === userId ? 'default' : 'outline'}
              className="h-11"
              disabled={!s.hasPin}
              aria-pressed={s.id === userId}
              onClick={() => setUserId(s.id)}
              title={s.hasPin ? undefined : 'No PIN set'}
            >
              {s.name}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="switch-pin">PIN</Label>
          <Input
            id="switch-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="h-11 text-lg tracking-widest"
          />
        </div>
        <ErrorText error={error} />
        <Button type="submit" className="h-11 w-full" disabled={userId === null || pin.length < 4}>
          Switch
        </Button>
        {acting && (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => {
              setActing(null)
              onSwitched()
            }}
          >
            Back to {deviceUser.name}
          </Button>
        )}
      </form>
    </Modal>
  )
}
