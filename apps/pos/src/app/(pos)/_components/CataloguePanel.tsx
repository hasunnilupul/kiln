'use client'

import React, { forwardRef, useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'

import type { indexCatalogue } from '../_lib/cart'
import type { Money } from '../_lib/money'
import type { CatalogueCategory, CatalogueVariant } from '../_lib/types'

/**
 * Search box (barcode scanner, name or SKU) and the category grid (FR-30). A keyboard-wedge
 * scanner types the code and Enter; `3*code` adds three.
 */
export const CataloguePanel = forwardRef<
  HTMLInputElement,
  {
    index: ReturnType<typeof indexCatalogue>
    catalogue: { variants: CatalogueVariant[]; categories: CatalogueCategory[] }
    money: Money
    onAdd: (variant: CatalogueVariant, quantity?: number) => void
    onNotFound: (code: string, quantity: number) => void
  }
>(function CataloguePanel({ index, catalogue, money, onAdd, onNotFound }, ref) {
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const results = useMemo(() => index.search(query), [index, query])
  const shown = query
    ? results
    : categoryId === null
      ? []
      : catalogue.variants.filter((v) => v.categoryId === categoryId)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const match = /^(\d+)\*(.+)$/.exec(query.trim())
    const quantity = match ? Number(match[1]) : 1
    const code = match ? match[2]! : query.trim()
    if (!code) return
    const variant =
      index.lookup(code) ?? (index.search(code).length === 1 ? index.search(code)[0] : undefined)
    if (variant) {
      onAdd(variant, quantity)
      setQuery('')
    } else if (results.length === 0) {
      onNotFound(code, quantity)
      setQuery('')
    }
  }

  const topCategories = catalogue.categories.filter((c) => c.parentId === null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={submit} className="border-b p-3">
        <Input
          ref={ref}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Scan a barcode or search by name or SKU (F2)"
          aria-label="Scan or search"
          className="h-12 text-lg"
        />
      </form>

      {!query && (
        <nav aria-label="Categories" className="flex flex-wrap gap-2 border-b p-3">
          {topCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id === categoryId ? null : category.id)}
              aria-pressed={category.id === categoryId}
              className="h-11 rounded-lg border px-4 font-medium aria-pressed:ring-2 aria-pressed:ring-ring"
              style={{
                background: category.colour ?? undefined,
                color: category.colour ? '#fff' : undefined,
              }}
            >
              {category.name}
            </button>
          ))}
          {catalogue.categories
            .filter((c) => categoryId !== null && c.parentId === categoryId)
            .map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => setCategoryId(sub.id)}
                className="h-11 rounded-lg border border-dashed px-4"
              >
                {sub.name}
              </button>
            ))}
        </nav>
      )}

      <ul className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 overflow-y-auto p-3">
        {shown.map((variant) => (
          <li key={variant.id}>
            <button
              type="button"
              onClick={() => onAdd(variant)}
              className="flex h-24 w-full flex-col justify-between rounded-lg border bg-card p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="line-clamp-2 text-sm font-medium">{variant.name}</span>
              <span className="text-sm text-muted-foreground">{money.format(variant.price)}</span>
            </button>
          </li>
        ))}
        {query && results.length === 0 && (
          <li className="col-span-full text-muted-foreground">No items match “{query}”.</li>
        )}
      </ul>
    </div>
  )
})
