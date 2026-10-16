'use client'

import type { ShiftSummary } from '@kiln/pricing'
import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { api } from '../../_lib/api'
import type { Money } from '../../_lib/money'
import { ErrorText, Modal, message } from './Modal'

/** Managers pay cash into or out of the drawer with a reason (FR-62). */
export function CashMovementDialog({
  shiftId,
  money,
  onClose,
}: {
  shiftId: number
  money: Money
  onClose: () => void
}) {
  const [type, setType] = useState<'in' | 'out'>('out')
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const amount = money.parse(amountText)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (amount === null || amount <= 0 || !reason.trim())
      return setError('Enter an amount and a reason.')
    try {
      await api(`/api/pos/shifts/${shiftId}/cash-movements`, { body: { type, amount, reason } })
      onClose()
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <Modal title="Cash in or out" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['in', 'out'] as const).map((t) => (
            <Button
              key={t}
              type="button"
              variant={t === type ? 'default' : 'outline'}
              className="h-11"
              aria-pressed={t === type}
              onClick={() => setType(t)}
            >
              Cash {t}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-amount">Amount</Label>
          <Input
            id="cash-amount"
            inputMode="decimal"
            autoFocus
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-reason">Reason</Label>
          <Input
            id="cash-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-11"
          />
        </div>
        <ErrorText error={error} />
        <Button type="submit" className="h-11 w-full">
          Record cash {type}
        </Button>
      </form>
    </Modal>
  )
}

/** Counts the drawer, closes the shift and shows expected cash and variance (FR-61). */
export function CloseShiftDialog({
  shiftId,
  money,
  methodLabels,
  onClose,
  onClosed,
}: {
  shiftId: number
  money: Money
  /** Payment method code to label, for the summary. */
  methodLabels: Record<string, string>
  onClose: () => void
  onClosed: () => void
}) {
  const [countedText, setCountedText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    summary: ShiftSummary
    shift: { variance: number; countedCash: number }
  } | null>(null)
  const counted = money.parse(countedText)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (counted === null) return setError('Enter the cash counted in the drawer.')
    try {
      setResult(await api(`/api/pos/shifts/${shiftId}/close`, { body: { countedCash: counted } }))
    } catch (err) {
      setError(message(err))
    }
  }

  if (result) {
    const { summary, shift } = result
    return (
      <Modal title="Shift closed" onClose={onClosed} wide>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt>Opening float</dt>
          <dd className="text-right tabular-nums">{money.format(summary.openingFloat)}</dd>
          <dt>Sales ({summary.salesCount})</dt>
          <dd className="text-right tabular-nums">{money.format(summary.salesTotal)}</dd>
          <dt>Refunds ({summary.refundsCount})</dt>
          <dd className="text-right tabular-nums">−{money.format(summary.refundsTotal)}</dd>
          <dt>Cash in / out</dt>
          <dd className="text-right tabular-nums">
            {money.format(summary.cashIn)} / {money.format(summary.cashOut)}
          </dd>
          {summary.byMethod.map((m) => (
            <React.Fragment key={m.methodCode}>
              <dt className="pl-4 text-muted-foreground">
                {methodLabels[m.methodCode] ?? m.methodCode}
              </dt>
              <dd className="text-right tabular-nums text-muted-foreground">
                {money.format(m.net)}
              </dd>
            </React.Fragment>
          ))}
          <dt className="pt-2 font-semibold">Expected cash</dt>
          <dd className="pt-2 text-right font-semibold tabular-nums">
            {money.format(summary.expectedCash)}
          </dd>
          <dt>Counted cash</dt>
          <dd className="text-right tabular-nums">{money.format(shift.countedCash)}</dd>
          <dt className="font-semibold">Variance</dt>
          <dd
            className={`text-right font-semibold tabular-nums ${shift.variance === 0 ? '' : 'text-destructive'}`}
          >
            {money.format(shift.variance)}
          </dd>
        </dl>
        <Button autoFocus className="h-11 w-full" onClick={onClosed}>
          Done
        </Button>
      </Modal>
    )
  }

  return (
    <Modal title="Close shift" description="Count the cash in the drawer." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="counted">Counted cash</Label>
          <Input
            id="counted"
            inputMode="decimal"
            autoFocus
            value={countedText}
            onChange={(e) => setCountedText(e.target.value)}
            className="h-12 text-lg"
          />
        </div>
        <ErrorText error={error} />
        <Button type="submit" className="h-11 w-full" disabled={counted === null}>
          Close shift
        </Button>
      </form>
    </Modal>
  )
}
