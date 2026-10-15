'use client'

import React, { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { api } from '../../_lib/api'
import type { StaffMember } from '../../_lib/types'
import { ErrorText, Modal, message } from './Modal'

export interface ApprovalRequest {
  title: string
  run: (approval: { managerId: number; pin: string }) => Promise<void>
}

/** A manager picks their name and enters their PIN to approve an action (FR-13). */
export function ApprovalDialog({
  request,
  onClose,
}: {
  request: ApprovalRequest
  onClose: () => void
}) {
  const [managers, setManagers] = useState<StaffMember[]>([])
  const [managerId, setManagerId] = useState<number | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ staff: StaffMember[] }>('/api/pos/staff')
      .then(({ staff }) => {
        const approvers = staff.filter(
          (s) => s.hasPin && (s.role === 'manager' || s.role === 'admin'),
        )
        setManagers(approvers)
        if (approvers.length === 1) setManagerId(approvers[0]!.id)
      })
      .catch((err) => setError(message(err)))
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (managerId === null) return
    setBusy(true)
    setError(null)
    try {
      await request.run({ managerId, pin })
      onClose()
    } catch (err) {
      setError(message(err))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={request.title} description="A manager must approve this." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {managers.map((m) => (
            <Button
              key={m.id}
              type="button"
              variant={m.id === managerId ? 'default' : 'outline'}
              className="h-11"
              aria-pressed={m.id === managerId}
              onClick={() => setManagerId(m.id)}
            >
              {m.name}
            </Button>
          ))}
          {managers.length === 0 && (
            <p className="col-span-2 text-sm text-muted-foreground">
              No manager with a PIN works at this outlet.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="approval-pin">Manager PIN</Label>
          <Input
            id="approval-pin"
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
        <Button
          type="submit"
          className="h-11 w-full"
          disabled={busy || managerId === null || pin.length < 4}
        >
          Approve
        </Button>
      </form>
    </Modal>
  )
}
