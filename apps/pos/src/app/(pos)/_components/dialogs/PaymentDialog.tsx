'use client'

import { settlePayments } from '@kiln/pricing'
import React, { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { Money } from '../../_lib/money'
import type { Bootstrap } from '../../_lib/types'
import { ErrorText, Modal, message } from './Modal'

export interface CompletedSale {
  id: number
  receiptNumber: string
  total: number
  change: number
}

interface Tender {
  paymentMethodId: number
  amount: number
  reference?: string
}

/**
 * Takes one or more tenders (FR-40): cash shows change, card needs the cashier's confirmation and
 * a reference where required (FR-41). The server re-checks everything when the sale is finalised.
 */
export function PaymentDialog({
  total,
  methods,
  money,
  onStarted,
  onFinalise,
  onClose,
}: {
  total: number
  methods: Bootstrap['paymentMethods']
  money: Money
  onStarted: () => void
  onFinalise: (tenders: Tender[]) => Promise<void>
  onClose: () => void
}) {
  const [tenders, setTenders] = useState<Tender[]>([])
  const [methodId, setMethodId] = useState(
    methods.find((m) => m.type === 'cash')?.id ?? methods[0]?.id,
  )
  const [amountText, setAmountText] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const method = methods.find((m) => m.id === methodId)
  const settlement = settlePayments(
    total,
    tenders.map((t) => ({
      amount: t.amount,
      isCash: methods.find((m) => m.id === t.paymentMethodId)?.type === 'cash',
    })),
  )
  const amount = amountText === '' ? settlement.remaining : money.parse(amountText)
  const completeRef = useRef<HTMLButtonElement>(null)

  // Once paid, the amount field goes away; move focus so Enter completes the sale (keyboard flow).
  useEffect(() => {
    if (settlement.isSettled) completeRef.current?.focus()
  }, [settlement.isSettled])

  function addTender(event: React.FormEvent) {
    event.preventDefault()
    if (settlement.isSettled) return complete()
    if (!method || amount === null || amount <= 0) return setError('Enter an amount.')
    if (method.type !== 'cash' && amount > settlement.remaining) {
      return setError(
        `${method.label} cannot be more than the ${money.format(settlement.remaining)} due.`,
      )
    }
    if (method.requiresReference && !reference.trim())
      return setError(`Enter the ${method.label} reference.`)
    setError(null)
    setTenders([
      ...tenders,
      { paymentMethodId: method.id, amount, reference: reference.trim() || undefined },
    ])
    setAmountText('')
    setReference('')
    onStarted()
  }

  async function complete() {
    setBusy(true)
    setError(null)
    try {
      // On success the till replaces this dialog with the sale confirmation.
      await onFinalise(tenders)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Pay ${money.format(total)}`} onClose={onClose} wide>
      <form onSubmit={addTender} className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {methods.map((m) => (
            <Button
              key={m.id}
              type="button"
              variant={m.id === methodId ? 'default' : 'outline'}
              className="h-12"
              aria-pressed={m.id === methodId}
              onClick={() => setMethodId(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>

        {!settlement.isSettled && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tender">{method?.type === 'cash' ? 'Cash tendered' : 'Amount'}</Label>
              <Input
                id="tender"
                inputMode="decimal"
                autoFocus
                placeholder={money.toInput(settlement.remaining)}
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="h-12 text-lg"
              />
            </div>
            {method?.requiresReference && (
              <div className="space-y-2">
                <Label htmlFor="reference">Reference (e.g. approval code)</Label>
                <Input
                  id="reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="h-12"
                />
              </div>
            )}
          </div>
        )}

        {tenders.length > 0 && (
          <ul className="divide-y rounded border text-sm">
            {tenders.map((t, i) => (
              <li key={i} className="flex justify-between px-3 py-2">
                <span>
                  {methods.find((m) => m.id === t.paymentMethodId)?.label}
                  {t.reference && <span className="text-muted-foreground"> · {t.reference}</span>}
                </span>
                <span className="tabular-nums">{money.format(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-2 text-lg">
          <dt>{settlement.isSettled ? 'Change' : 'Still to pay'}</dt>
          <dd className="text-right font-semibold tabular-nums">
            {money.format(settlement.isSettled ? settlement.change : settlement.remaining)}
          </dd>
        </dl>

        <ErrorText error={error} />
        {settlement.isSettled ? (
          <Button ref={completeRef} type="submit" className="h-14 w-full text-lg" disabled={busy}>
            Complete sale
          </Button>
        ) : (
          <Button type="submit" className="h-12 w-full" disabled={amount === null}>
            {method?.type === 'cash' ? 'Take cash' : `Confirm ${method?.label ?? ''} approved`}{' '}
            {amount !== null && money.format(amount)}
          </Button>
        )}
      </form>
    </Modal>
  )
}
