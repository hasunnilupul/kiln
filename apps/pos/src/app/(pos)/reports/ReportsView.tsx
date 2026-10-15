'use client'

import Link from 'next/link'
import React, { useEffect, useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { api } from '../_lib/api'
import { makeMoney } from '../_lib/money'

interface Figures {
  salesCount: number
  gross: number
  discounts: number
  tax: number
  total: number
  refunds: number
  net: number
}

interface Report {
  range: { from: string; to: string; timeZone: string }
  totals: Figures
  byDay: (Figures & { date: string })[]
  byPaymentMethod: { code: string; method: string; taken: number; refunded: number; net: number }[]
  byProduct: {
    variantId: number
    sku: string
    name: string
    quantity: number
    total: number
    refundedQuantity: number
    refunded: number
    net: number
  }[]
  byCategory: { category: string; quantity: number; total: number; refunded: number; net: number }[]
  byCashier: (Figures & { cashier: string })[]
  byOutlet: (Figures & { outlet: string })[]
  shifts: {
    id: number
    openedAt: string
    closedAt: string | null
    status: string
    cashier: string
    outlet: string
    openingFloat: number
    salesTotal: number
    refundsTotal: number
    cashIn: number
    cashOut: number
    expectedCash: number
    countedCash: number | null
    variance: number | null
  }[]
  truncated: boolean
}

type Column<Row> = [header: string, cell: (row: Row) => React.ReactNode, numeric?: boolean]

function Table<Row>({ rows, columns }: { rows: Row[]; columns: Column<Row>[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          {columns.map(([header, , numeric]) => (
            <th key={header} className={`py-1 pr-3 font-medium ${numeric ? 'text-right' : ''}`}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="py-2 text-muted-foreground">
              Nothing in this period.
            </td>
          </tr>
        )}
        {rows.map((row, i) => (
          <tr key={i} className="border-b last:border-0">
            {columns.map(([header, cell, numeric]) => (
              <td key={header} className={`py-1 pr-3 ${numeric ? 'text-right tabular-nums' : ''}`}>
                {cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Section({
  title,
  csvHref,
  children,
}: {
  title: string
  csvHref: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2 rounded-xl bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <a
          className="inline-flex h-11 items-center rounded-lg border px-3 text-sm hover:bg-muted"
          href={csvHref}
        >
          Export CSV
        </a>
      </div>
      {children}
    </section>
  )
}

/** Date range and outlet filters, report tables and CSV downloads (FR-70 to FR-73). */
export function ReportsView({
  title,
  currency,
  locale,
  today,
  outlets,
}: {
  title: string
  currency: string
  locale: string
  today: string
  outlets: { id: number; name: string }[]
}) {
  const money = useMemo(() => makeMoney(currency, locale), [currency, locale])
  const m = (value: number | null) => (value === null ? '—' : money.format(value))
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [outletId, setOutletId] = useState<string>('')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  const params = new URLSearchParams({ from, to, ...(outletId ? { outletId } : {}) })
  const queryString = params.toString()

  useEffect(() => {
    api<Report>(`/api/pos/reports?${queryString}`)
      .then((r) => {
        setReport(r)
        setError(null)
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load reports'),
      )
  }, [queryString])

  const figures = <Row extends Figures>(): Column<Row>[] => [
    ['Sales', (r) => r.salesCount, true],
    ['Gross', (r) => m(r.gross), true],
    ['Discounts', (r) => m(r.discounts), true],
    ['Tax', (r) => m(r.tax), true],
    ['Total', (r) => m(r.total), true],
    ['Refunds', (r) => m(r.refunds), true],
    ['Net', (r) => m(r.net), true],
  ]

  const csv = (section: string) =>
    `/api/pos/reports/csv?${new URLSearchParams({ ...Object.fromEntries(params), section })}`

  return (
    <main className="min-h-screen space-y-4 bg-muted/40 p-6">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="mr-auto text-2xl font-semibold">{title} reports</h1>
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="h-11"
          />
        </div>
        {outlets.length > 1 && (
          <div className="space-y-1">
            <Label htmlFor="outlet">Outlet</Label>
            <select
              id="outlet"
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="h-11 rounded-lg border bg-background px-3"
            >
              <option value="">All my outlets</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Link
          href="/admin"
          className="inline-flex h-11 items-center rounded-lg border bg-background px-4 text-sm"
        >
          Admin
        </Link>
      </header>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {report?.truncated && (
        <p role="alert" className="text-destructive">
          This period has too many records to total; choose a shorter range.
        </p>
      )}

      {report && (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ['Sales', String(report.totals.salesCount)],
                ['Total taken', m(report.totals.total)],
                ['Refunds', m(report.totals.refunds)],
                ['Net', m(report.totals.net)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-background p-4 shadow-sm">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <Section title="Sales by day" csvHref={csv('byDay')}>
            <Table
              rows={report.byDay}
              columns={[['Date', (r) => r.date], ...figures<Report['byDay'][number]>()]}
            />
          </Section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Payment methods" csvHref={csv('byPaymentMethod')}>
              <Table
                rows={report.byPaymentMethod}
                columns={[
                  ['Method', (r) => r.method],
                  ['Taken', (r) => m(r.taken), true],
                  ['Refunded', (r) => m(r.refunded), true],
                  ['Net', (r) => m(r.net), true],
                ]}
              />
            </Section>
            <Section title="Categories" csvHref={csv('byCategory')}>
              <Table
                rows={report.byCategory}
                columns={[
                  ['Category', (r) => r.category],
                  ['Qty', (r) => r.quantity, true],
                  ['Sales', (r) => m(r.total), true],
                  ['Refunded', (r) => m(r.refunded), true],
                  ['Net', (r) => m(r.net), true],
                ]}
              />
            </Section>
          </div>
          <Section title="Products" csvHref={csv('byProduct')}>
            <Table
              rows={report.byProduct}
              columns={[
                ['SKU', (r) => r.sku],
                ['Name', (r) => r.name],
                ['Qty', (r) => r.quantity, true],
                ['Sales', (r) => m(r.total), true],
                ['Refunded qty', (r) => r.refundedQuantity, true],
                ['Net', (r) => m(r.net), true],
              ]}
            />
          </Section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Cashiers" csvHref={csv('byCashier')}>
              <Table
                rows={report.byCashier}
                columns={[['Cashier', (r) => r.cashier], ...figures<Report['byCashier'][number]>()]}
              />
            </Section>
            <Section title="Outlets" csvHref={csv('byOutlet')}>
              <Table
                rows={report.byOutlet}
                columns={[['Outlet', (r) => r.outlet], ...figures<Report['byOutlet'][number]>()]}
              />
            </Section>
          </div>
          <Section title="Shifts" csvHref={csv('shifts')}>
            <Table
              rows={report.shifts}
              columns={[
                [
                  'Opened',
                  (r) =>
                    new Date(r.openedAt).toLocaleString(locale, {
                      timeZone: report.range.timeZone,
                    }),
                ],
                ['Cashier', (r) => r.cashier],
                ['Outlet', (r) => r.outlet],
                ['Status', (r) => r.status],
                ['Float', (r) => m(r.openingFloat), true],
                ['Sales', (r) => m(r.salesTotal), true],
                ['Cash in/out', (r) => `${m(r.cashIn)} / ${m(r.cashOut)}`, true],
                ['Expected', (r) => m(r.expectedCash), true],
                ['Counted', (r) => m(r.countedCash), true],
                ['Variance', (r) => m(r.variance), true],
              ]}
            />
          </Section>
        </>
      )}
    </main>
  )
}
