'use client'

import React from 'react'

import { Button } from '@/components/ui/button'

import type { Money } from '../../_lib/money'
import type { CompletedSale } from './PaymentDialog'
import { Modal } from './Modal'

/** Confirms the sale with its number and change due. */
export function SaleCompleteDialog({
  sale,
  money,
  onClose,
}: {
  sale: CompletedSale
  money: Money
  onClose: () => void
}) {
  return (
    <Modal title={`Sale ${sale.receiptNumber} complete`} onClose={onClose}>
      <dl className="grid grid-cols-2 gap-y-2 text-lg">
        <dt>Total</dt>
        <dd className="text-right tabular-nums">{money.format(sale.total)}</dd>
        <dt className="font-semibold">Change</dt>
        <dd className="text-right text-2xl font-semibold tabular-nums">
          {money.format(sale.change)}
        </dd>
      </dl>
      <Button autoFocus className="h-12 w-full" onClick={onClose}>
        New sale
      </Button>
    </Modal>
  )
}
