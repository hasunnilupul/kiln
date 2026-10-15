'use client'

import type { Discount } from '@kiln/pricing'
import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { Money } from '../../_lib/money'
import { ErrorText, Modal } from './Modal'

/** Amount or percent discount on a line or the whole sale (FR-31). */
export function DiscountDialog({
  title,
  current,
  money,
  limitPercent,
  onApply,
  onClose,
}: {
  title: string
  current?: Discount
  money: Money
  limitPercent: number
  onApply: (discount?: Discount) => void
  onClose: () => void
}) {
  const [type, setType] = useState<Discount['type']>(current?.type ?? 'percent')
  const [value, setValue] = useState(
    current
      ? current.type === 'percent'
        ? String(current.percent)
        : money.toInput(current.amount)
      : '',
  )
  const [error, setError] = useState<string | null>(null)

  function apply(event: React.FormEvent) {
    event.preventDefault()
    if (type === 'percent') {
      const percent = Number(value)
      if (!value || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
        return setError('Enter a percentage from 0 to 100.')
      }
      onApply({ type, percent })
    } else {
      const amount = money.parse(value)
      if (amount === null || amount <= 0) return setError('Enter an amount.')
      onApply({ type, amount })
    }
  }

  return (
    <Modal
      title={title}
      description={`Discounts above ${limitPercent}% need a manager PIN at payment.`}
      onClose={onClose}
    >
      <form onSubmit={apply} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['percent', 'amount'] as const).map((t) => (
            <Button
              key={t}
              type="button"
              variant={t === type ? 'default' : 'outline'}
              className="h-11"
              aria-pressed={t === type}
              onClick={() => setType(t)}
            >
              {t === 'percent' ? 'Percent' : 'Amount'}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="discount-value">
            {type === 'percent' ? 'Percent off' : 'Amount off'}
          </Label>
          <Input
            id="discount-value"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-11 text-lg"
          />
        </div>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => onApply(undefined)}
          >
            Remove discount
          </Button>
          <Button type="submit" className="h-11">
            Apply
          </Button>
        </div>
      </form>
    </Modal>
  )
}
