import { currencyMinorDigits } from '@kiln/pricing'
import type { PayloadRequest, Where } from 'payload'
import { z } from 'zod'

import { hasRole, outletIds } from '../../access/roles'
import { decimal, toCsv, type CsvColumn } from '../../lib/csv'
import { addDays, startOfZonedDay } from '../../lib/dates'
import { buildSalesReport } from '../../lib/reports'
import { loadSettings } from '../../lib/settings'
import { loadShiftSummary } from '../../lib/shifts'
import { MANAGERS, PosError, posEndpoint, relId, requireUser, type StaffUser } from './http'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-MM-dd')
const query = z
  .object({ from: day, to: day, outletId: z.coerce.number().int().positive().optional() })
  .refine((q) => q.from <= q.to, 'from must not be after to')
  .refine((q) => addDays(q.from, 366) > q.to, 'At most one year at a time')

const MAX_DOCS = 50_000
const local = (req: PayloadRequest) =>
  ({ overrideAccess: true, req, pagination: false, depth: 0, limit: MAX_DOCS }) as const

/** Outlets in the report: the requested one if the user may see it, else all of theirs (FR-11). */
function scopeOutlets(user: StaffUser, outletId?: number): number[] | null {
  const mine = hasRole(user, 'admin') ? null : outletIds(user)
  if (outletId !== undefined) {
    if (mine && !mine.includes(outletId)) {
      throw new PosError(403, 'outlet_forbidden', 'This belongs to an outlet you do not work at')
    }
    return [outletId]
  }
  return mine
}

/** Loads and aggregates a period's sales, refunds and shifts for the user's outlets. */
async function loadReport(req: PayloadRequest, user: StaffUser) {
  const params = query.parse(Object.fromEntries(req.searchParams?.entries() ?? []))
  const settings = await loadSettings(req)
  const timeZone = settings.timezone
  const start = startOfZonedDay(params.from, timeZone).toISOString()
  const end = startOfZonedDay(addDays(params.to, 1), timeZone).toISOString()
  const outlets = scopeOutlets(user, params.outletId)
  const inOutlets: Where = outlets ? { outlet: { in: outlets } } : {}

  const [sales, refunds, shifts, users, outletDocs] = await Promise.all([
    req.payload.find({
      collection: 'sales',
      where: {
        and: [
          inOutlets,
          { completedAt: { greater_than_equal: start } },
          { completedAt: { less_than: end } },
        ],
      },
      ...local(req),
    }),
    req.payload.find({
      collection: 'refunds',
      where: {
        and: [
          inOutlets,
          { createdAt: { greater_than_equal: start } },
          { createdAt: { less_than: end } },
        ],
      },
      ...local(req),
    }),
    req.payload.find({
      collection: 'shifts',
      where: {
        and: [
          inOutlets,
          { openedAt: { greater_than_equal: start } },
          { openedAt: { less_than: end } },
        ],
      },
      sort: 'openedAt',
      ...local(req),
    }),
    req.payload.find({ collection: 'users', ...local(req) }),
    req.payload.find({ collection: 'outlets', ...local(req) }),
  ])

  const variantIds = new Set<number>()
  for (const doc of [...sales.docs, ...refunds.docs]) {
    for (const line of doc.lines) variantIds.add(relId(line.variant as number)!)
  }
  const variants = await req.payload.find({
    collection: 'product-variants',
    where: { id: { in: [...variantIds] } },
    ...local(req),
    depth: 2,
  })
  const categoryByVariant = new Map(
    variants.docs.map((v) => {
      const product = typeof v.product === 'object' ? v.product : null
      const category = product && typeof product.category === 'object' ? product.category : null
      return [v.id, category?.name ?? null]
    }),
  )
  const userNames = new Map(users.docs.map((u) => [u.id, u.name]))
  const outletNames = new Map(outletDocs.docs.map((o) => [o.id, o.name]))

  const days: string[] = []
  for (let d = params.from; d <= params.to; d = addDays(d, 1)) days.push(d)

  const toPayments = (
    payments: { methodCode: string; methodLabel: string; methodType: string; amount: number }[],
  ) =>
    payments.map((p) => ({
      methodCode: p.methodCode,
      methodLabel: p.methodLabel,
      isCash: p.methodType === 'cash',
      amount: p.amount,
    }))
  const toLines = (
    lines: { variant: unknown; sku: string; name: string; quantity: number; total: number }[],
  ) =>
    lines.map((l) => ({
      variantId: relId(l.variant as number)!,
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      total: l.total,
    }))

  const report = buildSalesReport(
    sales.docs.map((s) => ({
      completedAt: s.completedAt,
      outletId: relId(s.outlet as number)!,
      cashierId: relId(s.cashier as number)!,
      subtotal: s.subtotal,
      discountTotal: s.discountTotal,
      taxTotal: s.taxTotal,
      total: s.total,
      change: s.change,
      payments: toPayments(s.payments),
      lines: toLines(s.lines),
    })),
    refunds.docs.map((r) => ({
      createdAt: r.createdAt,
      outletId: relId(r.outlet as number)!,
      processedById: relId(r.processedBy as number)!,
      total: r.total,
      taxTotal: r.taxTotal,
      payouts: toPayments(r.payouts),
      lines: toLines(r.lines),
    })),
    {
      timeZone,
      days,
      categoryOf: (id) => categoryByVariant.get(id) ?? null,
      userName: (id) => userNames.get(id) ?? `User ${id}`,
      outletName: (id) => outletNames.get(id) ?? `Outlet ${id}`,
    },
  )

  // FR-72: float, sales, cash movements, expected and counted cash per shift.
  const shiftRows = await Promise.all(
    shifts.docs.map(async (shift) => {
      const summary = await loadShiftSummary(req, shift)
      return {
        id: shift.id,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt ?? null,
        status: shift.status,
        cashier: userNames.get(relId(shift.cashier as number)!) ?? '',
        outlet: outletNames.get(relId(shift.outlet as number)!) ?? '',
        openingFloat: shift.openingFloat,
        salesCount: summary.salesCount,
        salesTotal: summary.salesTotal,
        refundsTotal: summary.refundsTotal,
        cashIn: summary.cashIn,
        cashOut: summary.cashOut,
        expectedCash:
          shift.status === 'closed'
            ? (shift.expectedCash ?? summary.expectedCash)
            : summary.expectedCash,
        countedCash: shift.countedCash ?? null,
        variance: shift.variance ?? null,
      }
    }),
  )

  return {
    range: { from: params.from, to: params.to, timeZone, outletId: params.outletId ?? null },
    currency: settings.currency,
    ...report,
    shifts: shiftRows,
    truncated: sales.docs.length >= MAX_DOCS || refunds.docs.length >= MAX_DOCS,
  }
}

/** `GET /api/pos/reports?from=&to=&outletId=`: the period's reports for managers (FR-70 to FR-72). */
export const reportsJson = posEndpoint({
  method: 'get',
  path: '/reports',
  handler: async (req) => loadReport(req, await requireUser(req, MANAGERS)),
})

type Report = Awaited<ReturnType<typeof loadReport>>

const SECTIONS = [
  'byDay',
  'byPaymentMethod',
  'byProduct',
  'byCategory',
  'byCashier',
  'byOutlet',
  'shifts',
] as const

/** CSV columns per report section; money as plain decimals. */
function csvFor(report: Report, section: (typeof SECTIONS)[number]): string {
  const digits = currencyMinorDigits(report.currency)
  const m = (value: number | null) => (value === null ? null : decimal(value, digits))
  const figures = <
    Row extends {
      salesCount: number
      gross: number
      discounts: number
      tax: number
      total: number
      refunds: number
      net: number
    },
  >(): CsvColumn<Row>[] => [
    { header: 'Sales', value: (r) => r.salesCount },
    { header: 'Gross', value: (r) => m(r.gross) },
    { header: 'Discounts', value: (r) => m(r.discounts) },
    { header: 'Tax', value: (r) => m(r.tax) },
    { header: 'Total', value: (r) => m(r.total) },
    { header: 'Refunds', value: (r) => m(r.refunds) },
    { header: 'Net', value: (r) => m(r.net) },
  ]
  switch (section) {
    case 'byDay':
      return toCsv(report.byDay, [{ header: 'Date', value: (r) => r.date }, ...figures()])
    case 'byCashier':
      return toCsv(report.byCashier, [{ header: 'Cashier', value: (r) => r.cashier }, ...figures()])
    case 'byOutlet':
      return toCsv(report.byOutlet, [{ header: 'Outlet', value: (r) => r.outlet }, ...figures()])
    case 'byPaymentMethod':
      return toCsv(report.byPaymentMethod, [
        { header: 'Method', value: (r) => r.method },
        { header: 'Taken', value: (r) => m(r.taken) },
        { header: 'Refunded', value: (r) => m(r.refunded) },
        { header: 'Net', value: (r) => m(r.net) },
      ])
    case 'byProduct':
      return toCsv(report.byProduct, [
        { header: 'SKU', value: (r) => r.sku },
        { header: 'Name', value: (r) => r.name },
        { header: 'Quantity', value: (r) => r.quantity },
        { header: 'Sales', value: (r) => m(r.total) },
        { header: 'Refunded quantity', value: (r) => r.refundedQuantity },
        { header: 'Refunded', value: (r) => m(r.refunded) },
        { header: 'Net', value: (r) => m(r.net) },
      ])
    case 'byCategory':
      return toCsv(report.byCategory, [
        { header: 'Category', value: (r) => r.category },
        { header: 'Quantity', value: (r) => r.quantity },
        { header: 'Sales', value: (r) => m(r.total) },
        { header: 'Refunded', value: (r) => m(r.refunded) },
        { header: 'Net', value: (r) => m(r.net) },
      ])
    case 'shifts':
      return toCsv(report.shifts, [
        { header: 'Shift', value: (r) => r.id },
        { header: 'Outlet', value: (r) => r.outlet },
        { header: 'Cashier', value: (r) => r.cashier },
        { header: 'Opened', value: (r) => r.openedAt },
        { header: 'Closed', value: (r) => r.closedAt },
        { header: 'Float', value: (r) => m(r.openingFloat) },
        { header: 'Sales', value: (r) => m(r.salesTotal) },
        { header: 'Refunds', value: (r) => m(r.refundsTotal) },
        { header: 'Cash in', value: (r) => m(r.cashIn) },
        { header: 'Cash out', value: (r) => m(r.cashOut) },
        { header: 'Expected cash', value: (r) => m(r.expectedCash) },
        { header: 'Counted cash', value: (r) => m(r.countedCash) },
        { header: 'Variance', value: (r) => m(r.variance) },
      ])
  }
}

/** `GET /api/pos/reports/csv?section=&from=&to=&outletId=`: any report section as CSV (FR-73). */
export const reportsCsv = posEndpoint({
  method: 'get',
  path: '/reports/csv',
  handler: async (req) => {
    const user = await requireUser(req, MANAGERS)
    const section = z.enum(SECTIONS).parse(req.searchParams?.get('section'))
    const report = await loadReport(req, user)
    const name = `${section}-${report.range.from}-to-${report.range.to}.csv`
    return new Response(csvFor(report, section), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  },
})

export const reportEndpoints = [reportsJson, reportsCsv]
