'use client'

import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { api } from '../../_lib/api'
import { printReceipt } from '../../_lib/print'
import { ErrorText, Modal, message } from './Modal'

/** Reprints any past receipt, marked "REPRINT" (FR-44). */
export function ReprintDialog({ onClose }: { onClose: () => void }) {
  const [receipt, setReceipt] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
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
      printReceipt(sale.id, { reprint: true })
      onClose()
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <Modal title="Reprint a receipt" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input
          autoFocus
          placeholder="Scan the receipt or type its number"
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
          className="h-11"
          aria-label="Receipt number"
        />
        <ErrorText error={error} />
        <Button type="submit" className="h-11 w-full" disabled={!receipt.trim()}>
          Reprint
        </Button>
      </form>
    </Modal>
  )
}
