'use client'

import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { api } from '../../_lib/api'
import type { Money } from '../../_lib/money'
import type { Bootstrap, OpenShift } from '../../_lib/types'
import type { ApprovalRequest } from './ApprovalDialog'
import { ErrorText, Modal, message } from './Modal'

interface RefundableLine {
  saleLineId: string
  name: string
  quantity: number
  refundableQuantity: number
  total: number
}

interface Refundable {
  sale: { id: number; receiptNumber: string; completedAt: string; total: number }
  lines: RefundableLine[]
}

/**
 * Refunds all or part of a sale found by receipt number or barcode (FR-50), paying out the exact
 * server-computed amount with a manager's approval and optional restock per line (FR-13, FR-51).
 */
export function RefundDialog({
  shift,
  methods,
  money,
  withApproval,
  onClose,
}: {
  shift: OpenShift
  methods: Bootstrap['paymentMethods']
  money: Money
  withApproval: (title: string, run: ApprovalRequest['run']) => void
  onClose: () => void
}) {
  const [receipt, setReceipt] = useState('')
  const [found, setFound] = useState<Refundable | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [restock, setRestock] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<{ total: number } | null>(null)
  const [methodId, setMethodId] = useState(
    methods.find((m) => m.type === 'cash')?.id ?? methods[0]?.id,
  )
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  async function lookUp(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const params = new URLSearchParams({
        'where[receiptNumber][equals]': receipt.trim(),
        depth: '0',
        limit: '1',
      })
      const sales = await api<{ docs: { id: number }[] }>(`/api/sales?${params}`)
      const sale = sales.docs[0]
      if (!sale) return setError(`No sale ${receipt.trim()} at your outlets.`)
      const result = await api<Refundable>(`/api/pos/sales/${sale.id}/refundable`)
      setFound(result)
      setQuantities({})
      setRestock(Object.fromEntries(result.lines.map((l) => [l.saleLineId, true])))
      setPreview(null)
    } catch (err) {
      setError(message(err))
    }
  }

  const lines = found
    ? found.lines
        .filter((l) => (quantities[l.saleLineId] ?? 0) > 0)
        .map((l) => ({
          saleLineId: l.saleLineId,
          quantity: quantities[l.saleLineId]!,
          restock: restock[l.saleLineId] ?? true,
        }))
    : []

  async function price() {
    if (!found || lines.length === 0) return
    try {
      const result = await api<{ refund: { total: number } }>('/api/pos/refunds/preview', {
        body: { saleId: found.sale.id, lines },
      })
      setPreview(result.refund)
      setError(null)
    } catch (err) {
      setError(message(err))
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!found || !preview || !methodId) return
    if (!reason.trim()) return setError('Enter a reason.')
    const method = methods.find((m) => m.id === methodId)
    if (method?.requiresReference && !reference.trim())
      return setError(`Enter the ${method.label} reference.`)
    withApproval(`Approve refund of ${money.format(preview.total)}`, async (approval) => {
      await api('/api/pos/refunds', {
        body: {
          saleId: found.sale.id,
          shiftId: shift.id,
          lines,
          payouts: [
            {
              paymentMethodId: methodId,
              amount: preview.total,
              reference: reference.trim() || undefined,
            },
          ],
          reason: reason.trim(),
          approval,
        },
      })
      setDone(preview.total)
    })
  }

  if (done !== null) {
    return (
      <Modal title="Refund complete" onClose={onClose}>
        <p className="text-lg">
          Pay out <strong>{money.format(done)}</strong> by{' '}
          {methods.find((m) => m.id === methodId)?.label}.
        </p>
        <Button autoFocus className="h-11 w-full" onClick={onClose}>
          Done
        </Button>
      </Modal>
    )
  }

  return (
    <Modal title="Refund" onClose={onClose} wide>
      <form onSubmit={lookUp} className="flex gap-2">
        <Input
          autoFocus
          placeholder="Scan the receipt or type its number, e.g. R1-000042"
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
          className="h-11"
          aria-label="Receipt number"
        />
        <Button type="submit" className="h-11">
          Find
        </Button>
      </form>

      {found && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sale {found.sale.receiptNumber} · {new Date(found.sale.completedAt).toLocaleString()} ·{' '}
            {money.format(found.sale.total)}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">Item</th>
                <th>Refundable</th>
                <th>Refund</th>
                <th>Restock</th>
              </tr>
            </thead>
            <tbody>
              {found.lines.map((line) => (
                <tr key={line.saleLineId} className="border-t">
                  <td className="py-1">{line.name}</td>
                  <td className="tabular-nums">
                    {line.refundableQuantity} of {line.quantity}
                  </td>
                  <td>
                    <Input
                      type="number"
                      min={0}
                      max={line.refundableQuantity}
                      disabled={line.refundableQuantity === 0}
                      value={quantities[line.saleLineId] ?? 0}
                      onChange={(e) => {
                        setPreview(null)
                        setQuantities({
                          ...quantities,
                          [line.saleLineId]: Math.min(
                            line.refundableQuantity,
                            Math.max(0, Number(e.target.value) || 0),
                          ),
                        })
                      }}
                      className="h-11 w-20"
                      aria-label={`Quantity of ${line.name} to refund`}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={restock[line.saleLineId] ?? true}
                      onChange={(e) =>
                        setRestock({ ...restock, [line.saleLineId]: e.target.checked })
                      }
                      aria-label={`Restock ${line.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!preview ? (
            <Button
              type="button"
              className="h-11 w-full"
              disabled={lines.length === 0}
              onClick={price}
            >
              Calculate refund
            </Button>
          ) : (
            <>
              <p className="text-lg">
                Refund <strong>{money.format(preview.total)}</strong>
              </p>
              <div className="grid grid-cols-4 gap-2">
                {methods.map((m) => (
                  <Button
                    key={m.id}
                    type="button"
                    variant={m.id === methodId ? 'default' : 'outline'}
                    className="h-11"
                    aria-pressed={m.id === methodId}
                    onClick={() => setMethodId(m.id)}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
              {methods.find((m) => m.id === methodId)?.requiresReference && (
                <div className="space-y-2">
                  <Label htmlFor="refund-reference">Reference</Label>
                  <Input
                    id="refund-reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="h-11"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="refund-reason">Reason</Label>
                <Input
                  id="refund-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-11"
                />
              </div>
              <Button type="submit" className="h-11 w-full">
                Refund {money.format(preview.total)}
              </Button>
            </>
          )}
        </form>
      )}
      <ErrorText error={error} />
    </Modal>
  )
}
