'use client'

import type { CartTotals } from '@kiln/pricing'
import { Minus, Percent, Plus, Trash2 } from 'lucide-react'
import React from 'react'

import { Button } from '@/components/ui/button'

import type { Money } from '../_lib/money'
import type { Cart } from '../_lib/types'

/** Cart lines with quantity, discount and remove controls, and the totals (FR-31, FR-32). */
export function CartPanel({
  cart,
  totals,
  pricingError,
  money,
  selected,
  discountsEnabled,
  customersEnabled,
  onSelect,
  onQuantity,
  onRemove,
  onDiscount,
  onCustomer,
}: {
  cart: Cart
  totals?: CartTotals
  pricingError?: string
  money: Money
  selected: number
  discountsEnabled: boolean
  customersEnabled: boolean
  onSelect: (index: number) => void
  onQuantity: (key: string, quantity: number) => void
  onRemove: (key: string) => void
  onDiscount: (lineKey?: string) => void
  onCustomer: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol aria-label="Cart" className="flex-1 overflow-y-auto">
        {cart.lines.length === 0 && (
          <li className="p-6 text-center text-muted-foreground">Cart is empty</li>
        )}
        {cart.lines.map((line, index) => {
          const priced = totals?.lines[index]
          return (
            <li
              key={line.key}
              aria-current={index === selected}
              onClick={() => onSelect(index)}
              className="flex items-center gap-2 border-b px-3 py-2 aria-[current=true]:bg-muted"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{line.name}</div>
                <div className="text-xs text-muted-foreground">
                  {money.format(line.unitPrice)}
                  {priced && priced.lineDiscount + priced.cartDiscount > 0 && (
                    <> · −{money.format(priced.lineDiscount + priced.cartDiscount)}</>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="size-11"
                aria-label={`One fewer ${line.name}`}
                onClick={() =>
                  line.quantity > 1 ? onQuantity(line.key, line.quantity - 1) : onRemove(line.key)
                }
              >
                <Minus />
              </Button>
              <span className="w-8 text-center tabular-nums" aria-label="Quantity">
                {line.quantity}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-11"
                aria-label={`One more ${line.name}`}
                onClick={() => onQuantity(line.key, line.quantity + 1)}
              >
                <Plus />
              </Button>
              {discountsEnabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`Discount ${line.name}`}
                  onClick={() => onDiscount(line.key)}
                >
                  <Percent />
                </Button>
              )}
              <span className="w-24 text-right tabular-nums">
                {priced ? money.format(priced.total) : '—'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={`Remove ${line.name}`}
                onClick={() => onRemove(line.key)}
              >
                <Trash2 />
              </Button>
            </li>
          )
        })}
      </ol>

      <div className="space-y-1 border-t p-3 text-sm">
        <div className="flex gap-2">
          {discountsEnabled && (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => onDiscount()}
              disabled={cart.lines.length === 0}
            >
              {cart.cartDiscount ? 'Change sale discount' : 'Discount sale'}
            </Button>
          )}
          {customersEnabled && (
            <Button variant="outline" className="h-11 min-w-0 flex-1 truncate" onClick={onCustomer}>
              {cart.customer ? `Customer: ${cart.customer.name}` : 'Add customer'}
            </Button>
          )}
        </div>
        {pricingError && (
          <p role="alert" className="text-destructive">
            {pricingError}
          </p>
        )}
        {totals && (
          <dl className="grid grid-cols-2 gap-y-1 pt-2">
            <dt>Subtotal</dt>
            <dd className="text-right tabular-nums">{money.format(totals.subtotal)}</dd>
            {totals.discountTotal > 0 && (
              <>
                <dt>Discounts</dt>
                <dd className="text-right tabular-nums">−{money.format(totals.discountTotal)}</dd>
              </>
            )}
            <dt>Tax</dt>
            <dd className="text-right tabular-nums">{money.format(totals.taxTotal)}</dd>
            <dt className="text-lg font-semibold">Total</dt>
            <dd className="text-right text-lg font-semibold tabular-nums">
              {money.format(totals.total)}
            </dd>
          </dl>
        )}
      </div>
    </div>
  )
}
