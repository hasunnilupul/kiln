'use client'

import type { Discount } from '@kiln/pricing'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { Button } from '@/components/ui/button'

import { api, ApiError } from '../_lib/api'
import {
  cartReducer,
  emptyCart,
  indexCatalogue,
  loadParked,
  priceCart,
  saveParked,
  subscribeParked,
} from '../_lib/cart'
import type { Money } from '../_lib/money'
import type {
  Bootstrap,
  CatalogueCategory,
  CatalogueVariant,
  OpenShift,
  TillUser,
} from '../_lib/types'
import { CartPanel } from './CartPanel'
import { CataloguePanel } from './CataloguePanel'
import { ApprovalDialog, type ApprovalRequest } from './dialogs/ApprovalDialog'
import { CustomerDialog } from './dialogs/CustomerDialog'
import { DiscountDialog } from './dialogs/DiscountDialog'
import { ParkedDialog } from './dialogs/ParkedDialog'
import { PaymentDialog, type CompletedSale } from './dialogs/PaymentDialog'
import { RefundDialog } from './dialogs/RefundDialog'
import { SaleCompleteDialog } from './dialogs/SaleCompleteDialog'
import { CashMovementDialog, CloseShiftDialog } from './dialogs/ShiftDialogs'

type Dialog =
  | { kind: 'pay' }
  | { kind: 'discount'; lineKey?: string }
  | { kind: 'customer' }
  | { kind: 'parked' }
  | { kind: 'refund' }
  | { kind: 'cash' }
  | { kind: 'close' }
  | { kind: 'complete'; sale: CompletedSale }
  | null

/** The checkout: catalogue, cart, payment and shift actions, all usable by keyboard (FR-30 to FR-34). */
export function TillScreen({
  bootstrap,
  money,
  user,
  shift,
  catalogue,
  refreshCatalogue,
  onShiftClosed,
  onSwitchUser,
  onError,
}: {
  bootstrap: Bootstrap
  money: Money
  user: TillUser
  shift: OpenShift
  catalogue: { variants: CatalogueVariant[]; categories: CatalogueCategory[] }
  refreshCatalogue: () => Promise<{ variants: CatalogueVariant[] }>
  onShiftClosed: () => void
  onSwitchUser: () => void
  onError: (error: unknown) => void
}) {
  const { settings } = bootstrap
  const [cart, dispatch] = useReducer(cartReducer, undefined, emptyCart)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [selectedRaw, setSelected] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const index = useMemo(() => indexCatalogue(catalogue.variants), [catalogue.variants])
  const priced = useMemo(
    () => priceCart(cart, settings.pricesIncludeTax),
    [cart, settings.pricesIncludeTax],
  )
  const isManager = user.role === 'admin' || user.role === 'manager'

  const parkedCount = useSyncExternalStore(
    subscribeParked,
    () => loadParked(shift.register.id).length,
    () => 0,
  )
  const selected = Math.min(selectedRaw, Math.max(cart.lines.length - 1, 0))

  /** Asks a manager to approve, then runs `action` (FR-13). */
  const withApproval = useCallback(
    (title: string, run: (approval: { managerId: number; pin: string }) => Promise<void>) =>
      setApproval({ title, run }),
    [],
  )

  /** Voiding after payment has started needs a manager (FR-13). */
  const guardVoid = useCallback(
    (detail: string, apply: () => void) => {
      if (!cart.paymentStarted) return apply()
      withApproval(`Approve: ${detail}`, async (approval) => {
        await api('/api/pos/approvals', {
          body: { action: 'void_line', outletId: shift.outletId, approval, details: { detail } },
        })
        apply()
      })
    },
    [cart.paymentStarted, shift.outletId, withApproval],
  )

  const setQuantity = (key: string, quantity: number) => {
    const line = cart.lines.find((l) => l.key === key)
    if (!line) return
    if (quantity < line.quantity) {
      guardVoid(`reduce ${line.name} to ${quantity}`, () =>
        dispatch({ type: 'setQuantity', key, quantity }),
      )
    } else {
      dispatch({ type: 'setQuantity', key, quantity })
    }
  }
  const removeLine = (key: string) => {
    const line = cart.lines.find((l) => l.key === key)
    if (line) guardVoid(`remove ${line.name}`, () => dispatch({ type: 'remove', key }))
  }

  function park() {
    if (cart.lines.length === 0) return
    const parked = loadParked(shift.register.id)
    saveParked(shift.register.id, [...parked, { cart, parkedAt: new Date().toISOString() }])
    dispatch({ type: 'clear' })
  }

  const canPay = cart.lines.length > 0 && Boolean(priced.totals)

  // Keyboard: F-keys anywhere; line keys when the search box is empty (FR-30, NFR keyboard flow).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (dialog || approval) return
      const keys: Record<string, () => void> = {
        F2: () => searchRef.current?.focus(),
        F4: () => canPay && setDialog({ kind: 'pay' }),
        F6: park,
        F7: () => setDialog({ kind: 'parked' }),
        F8: () => setDialog({ kind: 'refund' }),
        F9: onSwitchUser,
      }
      const handler = keys[event.key]
      if (handler) {
        event.preventDefault()
        handler()
        return
      }
      const inEmptySearch =
        document.activeElement === searchRef.current && !searchRef.current?.value
      if (!inEmptySearch || cart.lines.length === 0) return
      const line = cart.lines[selected]
      if (event.key === 'ArrowDown') setSelected((s) => Math.min(s + 1, cart.lines.length - 1))
      else if (event.key === 'ArrowUp') setSelected((s) => Math.max(s - 1, 0))
      else if (line && (event.key === '+' || event.key === '='))
        setQuantity(line.key, line.quantity + 1)
      else if (line && event.key === '-') setQuantity(line.key, line.quantity - 1)
      else if (line && event.key === 'Delete') removeLine(line.key)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function addVariant(variant: CatalogueVariant, quantity = 1) {
    dispatch({ type: 'add', variant, quantity })
    searchRef.current?.focus()
  }

  /** A scan the till does not know: refresh the catalogue once, then retry (new items). */
  async function addAfterRefresh(code: string, quantity: number) {
    try {
      const fresh = await refreshCatalogue()
      const variant = indexCatalogue(fresh.variants).lookup(code)
      if (variant) addVariant(variant, quantity)
      else onError(new Error(`No item with barcode or SKU "${code}"`))
    } catch (error) {
      onError(error)
    }
  }

  async function finalise(
    payments: { paymentMethodId: number; amount: number; reference?: string }[],
    approvalInput?: { managerId: number; pin: string },
  ): Promise<void> {
    const body = {
      clientRef: cart.clientRef,
      shiftId: shift.id,
      lines: cart.lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        discount: l.discount,
      })),
      cartDiscount: cart.cartDiscount,
      customerId: cart.customer?.id,
      payments,
      approval: approvalInput,
    }
    try {
      const result = await api<{ sale: CompletedSale }>('/api/pos/sales/finalise', { body })
      dispatch({ type: 'clear' })
      setDialog({ kind: 'complete', sale: result.sale })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'approval_required') {
        setDialog(null)
        withApproval('Approve the discount', (approval) => finalise(payments, approval))
        return
      }
      throw error
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-[3] flex-col border-r bg-background">
        <CataloguePanel
          ref={searchRef}
          index={index}
          catalogue={catalogue}
          money={money}
          onAdd={addVariant}
          onNotFound={addAfterRefresh}
        />
      </section>

      <section className="flex w-[40%] min-w-[380px] flex-col bg-background">
        <CartPanel
          cart={cart}
          totals={priced.totals}
          pricingError={priced.error}
          money={money}
          selected={selected}
          discountsEnabled={settings.modules.discounts}
          customersEnabled={settings.modules.customers}
          onSelect={setSelected}
          onQuantity={setQuantity}
          onRemove={removeLine}
          onDiscount={(lineKey) => setDialog({ kind: 'discount', lineKey })}
          onCustomer={() => setDialog({ kind: 'customer' })}
        />
        <div className="grid grid-cols-3 gap-2 border-t p-3">
          <Button
            variant="outline"
            className="h-11"
            onClick={park}
            disabled={cart.lines.length === 0}
            title="F6"
          >
            Park
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setDialog({ kind: 'parked' })}
            title="F7"
          >
            Resume{parkedCount > 0 && ` (${parkedCount})`}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setDialog({ kind: 'refund' })}
            title="F8"
          >
            Refund
          </Button>
          {isManager && (
            <Button variant="outline" className="h-11" onClick={() => setDialog({ kind: 'cash' })}>
              Cash in/out
            </Button>
          )}
          <Button variant="outline" className="h-11" onClick={() => setDialog({ kind: 'close' })}>
            Close shift
          </Button>
          <Button
            className="col-span-3 h-14 text-lg"
            onClick={() => setDialog({ kind: 'pay' })}
            disabled={!canPay}
            title="F4"
          >
            Pay {priced.totals ? money.format(priced.totals.total) : ''}
          </Button>
        </div>
        <p className="border-t px-3 py-1 text-xs text-muted-foreground">
          F2 search · F4 pay · F6 park · F7 resume · F8 refund · F9 switch user · ↑↓ + − Del on
          lines
        </p>
      </section>

      {dialog?.kind === 'pay' && priced.totals && (
        <PaymentDialog
          total={priced.totals.total}
          methods={bootstrap.paymentMethods}
          money={money}
          onStarted={() => dispatch({ type: 'paymentStarted' })}
          onFinalise={finalise}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'discount' && (
        <DiscountDialog
          money={money}
          limitPercent={settings.discountLimitPercent}
          current={
            dialog.lineKey
              ? cart.lines.find((l) => l.key === dialog.lineKey)?.discount
              : cart.cartDiscount
          }
          title={
            dialog.lineKey
              ? `Discount on ${cart.lines.find((l) => l.key === dialog.lineKey)?.name ?? 'line'}`
              : 'Discount on the whole sale'
          }
          onApply={(discount?: Discount) => {
            if (dialog.lineKey) dispatch({ type: 'lineDiscount', key: dialog.lineKey, discount })
            else dispatch({ type: 'cartDiscount', discount })
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'customer' && (
        <CustomerDialog
          current={cart.customer}
          onPick={(customer) => {
            dispatch({ type: 'customer', customer })
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'parked' && (
        <ParkedDialog
          registerId={shift.register.id}
          money={money}
          pricesIncludeTax={settings.pricesIncludeTax}
          onResume={(resumed) => {
            if (cart.lines.length > 0) park()
            dispatch({ type: 'replace', cart: resumed })
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'refund' && (
        <RefundDialog
          shift={shift}
          methods={bootstrap.paymentMethods}
          money={money}
          withApproval={withApproval}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'cash' && (
        <CashMovementDialog shiftId={shift.id} money={money} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'close' && (
        <CloseShiftDialog
          shiftId={shift.id}
          money={money}
          methodLabels={Object.fromEntries(bootstrap.paymentMethods.map((m) => [m.code, m.label]))}
          onClose={() => setDialog(null)}
          onClosed={() => {
            setDialog(null)
            onShiftClosed()
          }}
        />
      )}
      {dialog?.kind === 'complete' && (
        <SaleCompleteDialog sale={dialog.sale} money={money} onClose={() => setDialog(null)} />
      )}
      {approval && <ApprovalDialog request={approval} onClose={() => setApproval(null)} />}
    </div>
  )
}
