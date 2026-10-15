'use client'

import React, { useState } from 'react'

import { Button } from '@/components/ui/button'

import { loadParked, priceCart, saveParked } from '../../_lib/cart'
import type { Money } from '../../_lib/money'
import type { Cart } from '../../_lib/types'
import { Modal } from './Modal'

/** Carts parked on this register, to resume (FR-34). */
export function ParkedDialog({
  registerId,
  money,
  pricesIncludeTax,
  onResume,
  onClose,
}: {
  registerId: number
  money: Money
  pricesIncludeTax: boolean
  onResume: (cart: Cart) => void
  onClose: () => void
}) {
  const [parked, setParked] = useState(() => loadParked(registerId))

  function take(index: number) {
    const rest = parked.filter((_, i) => i !== index)
    saveParked(registerId, rest)
    setParked(rest)
    return parked[index]!.cart
  }

  return (
    <Modal title="Parked sales" onClose={onClose}>
      {parked.length === 0 ? (
        <p className="text-muted-foreground">Nothing is parked on this register.</p>
      ) : (
        <ul className="divide-y rounded border">
          {parked.map((entry, index) => {
            const total = priceCart(entry.cart, pricesIncludeTax).totals?.total
            const items = entry.cart.lines.reduce((sum, l) => sum + l.quantity, 0)
            return (
              <li key={entry.cart.clientRef} className="flex items-center gap-2 p-2">
                <div className="flex-1 text-sm">
                  <div>
                    {items} item{items === 1 ? '' : 's'}
                    {entry.cart.customer && ` · ${entry.cart.customer.name}`}
                  </div>
                  <div className="text-muted-foreground">
                    {new Date(entry.parkedAt).toLocaleTimeString()} ·{' '}
                    {total !== undefined ? money.format(total) : '—'}
                  </div>
                </div>
                <Button variant="ghost" className="h-11" onClick={() => take(index)}>
                  Discard
                </Button>
                <Button className="h-11" onClick={() => onResume(take(index))}>
                  Resume
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
