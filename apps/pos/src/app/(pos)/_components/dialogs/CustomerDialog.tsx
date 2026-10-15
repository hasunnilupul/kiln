'use client'

import React, { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { api } from '../../_lib/api'
import { ErrorText, Modal, message } from './Modal'

interface Customer {
  id: number
  name: string
  phone?: string | null
}

/** Finds or adds a customer to attach to the sale (FR-33). */
export function CustomerDialog({
  current,
  onPick,
  onClose,
}: {
  current?: { id: number; name: string }
  onPick: (customer?: { id: number; name: string }) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [error, setError] = useState<string | null>(null)

  const q = query.trim()
  const shown = q.length >= 2 ? results : []

  useEffect(() => {
    if (q.length < 2) return
    const params = new URLSearchParams({
      'where[or][0][name][like]': q,
      'where[or][1][phone][like]': q,
      limit: '10',
      depth: '0',
    })
    const timer = setTimeout(() => {
      api<{ docs: Customer[] }>(`/api/customers?${params}`)
        .then((r) => setResults(r.docs))
        .catch((err) => setError(message(err)))
    }, 150)
    return () => clearTimeout(timer)
  }, [q])

  async function addNew() {
    try {
      const created = await api<{ doc: Customer }>('/api/customers', {
        body: { name: query.trim() },
      })
      onPick({ id: created.doc.id, name: created.doc.name })
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <Modal title="Customer" onClose={onClose}>
      <div className="space-y-3">
        <Input
          autoFocus
          placeholder="Name or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11"
          aria-label="Search customers"
        />
        <ul className="divide-y rounded border">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex h-11 w-full items-center justify-between px-3 text-left hover:bg-muted"
                onClick={() => onPick({ id: c.id, name: c.name })}
              >
                <span>{c.name}</span>
                <span className="text-sm text-muted-foreground">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
        <ErrorText error={error} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-11"
            disabled={!current}
            onClick={() => onPick(undefined)}
          >
            Remove customer
          </Button>
          <Button className="h-11" disabled={query.trim().length < 2} onClick={addNew}>
            Add “{query.trim() || '…'}”
          </Button>
        </div>
      </div>
    </Modal>
  )
}
