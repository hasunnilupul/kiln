'use client'

import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { api } from '../_lib/api'
import type { Money } from '../_lib/money'
import type { Bootstrap } from '../_lib/types'

/** Opens a shift on a register with an opening float before selling (FR-60). */
export function OpenShiftPanel({
  registers,
  money,
  onOpened,
  onError,
}: {
  registers: Bootstrap['registers']
  money: Money
  onOpened: () => void
  onError: (error: unknown) => void
}) {
  const [registerId, setRegisterId] = useState(registers[0]?.id)
  const [float, setFloat] = useState('')
  const [busy, setBusy] = useState(false)
  const amount = money.parse(float)

  async function open(event: React.FormEvent) {
    event.preventDefault()
    if (!registerId || amount === null) return
    setBusy(true)
    try {
      await api('/api/pos/shifts/open', { body: { registerId, openingFloat: amount } })
      onOpened()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  if (registers.length === 0) {
    return (
      <p className="p-6 text-muted-foreground">You are not assigned to a register. Ask an admin.</p>
    )
  }

  return (
    <form
      onSubmit={open}
      className="m-auto w-full max-w-md space-y-5 rounded-xl bg-background p-6 shadow"
    >
      <h1 className="text-xl font-semibold">Open a shift</h1>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Register</legend>
        <div className="grid grid-cols-2 gap-2">
          {registers.map((register) => (
            <Button
              key={register.id}
              type="button"
              variant={register.id === registerId ? 'default' : 'outline'}
              className="h-14 flex-col"
              aria-pressed={register.id === registerId}
              onClick={() => setRegisterId(register.id)}
            >
              <span>{register.name}</span>
              <span className="text-xs opacity-75">{register.outletName}</span>
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="float">Opening float</Label>
        <Input
          id="float"
          inputMode="decimal"
          autoFocus
          placeholder={money.toInput(0)}
          value={float}
          onChange={(e) => setFloat(e.target.value)}
          className="h-11 text-lg"
          aria-invalid={float !== '' && amount === null}
        />
      </div>
      <Button
        type="submit"
        className="h-12 w-full"
        disabled={busy || amount === null || !registerId}
      >
        Open shift {amount !== null && `with ${money.format(amount)}`}
      </Button>
    </form>
  )
}
