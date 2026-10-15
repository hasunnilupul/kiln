import { zonedDay } from './dates'

export interface ReportPayment {
  methodCode: string
  methodLabel: string
  isCash: boolean
  amount: number
}

export interface ReportLine {
  variantId: number
  sku: string
  name: string
  quantity: number
  total: number
}

export interface ReportSale {
  completedAt: string
  outletId: number
  cashierId: number
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
  change: number
  payments: ReportPayment[]
  lines: ReportLine[]
}

export interface ReportRefund {
  createdAt: string
  outletId: number
  processedById: number
  total: number
  taxTotal: number
  payouts: ReportPayment[]
  lines: ReportLine[]
}

export interface ReportLookups {
  timeZone: string
  /** Calendar days covered, `yyyy-MM-dd`, so days without trade still appear. */
  days: string[]
  categoryOf: (variantId: number) => string | null
  userName: (id: number) => string
  outletName: (id: number) => string
}

/** Money in a report row: amounts taken net of refunds (FR-70). */
export interface SalesFigures {
  salesCount: number
  /** Before discounts. */
  gross: number
  discounts: number
  tax: number
  /** Charged, tax included. */
  total: number
  refunds: number
  refundTax: number
  /** `total − refunds`. */
  net: number
}

const emptyFigures = (): SalesFigures => ({
  salesCount: 0,
  gross: 0,
  discounts: 0,
  tax: 0,
  total: 0,
  refunds: 0,
  refundTax: 0,
  net: 0,
})

function addSale(f: SalesFigures, sale: ReportSale) {
  f.salesCount += 1
  f.gross += sale.subtotal
  f.discounts += sale.discountTotal
  f.tax += sale.taxTotal
  f.total += sale.total
  f.net += sale.total
}

function addRefund(f: SalesFigures, refund: ReportRefund) {
  f.refunds += refund.total
  f.refundTax += refund.taxTotal
  f.net -= refund.total
}

function grouped<Key, Value>(make: () => Value) {
  const map = new Map<Key, Value>()
  return {
    get: (key: Key) => {
      let value = map.get(key)
      if (!value) {
        value = make()
        map.set(key, value)
      }
      return value
    },
    entries: () => [...map.entries()],
  }
}

/** Cash payments net of the change handed back. */
function netPayments(sale: ReportSale): ReportPayment[] {
  let change = sale.change
  return sale.payments.map((p) => {
    if (!p.isCash || change === 0) return p
    const taken = Math.min(p.amount, change)
    change -= taken
    return { ...p, amount: p.amount - taken }
  })
}

/**
 * Sales summary by day and in total (FR-70) and breakdowns by payment method, product, category,
 * cashier and outlet (FR-71), each net of refunds made in the period.
 */
export function buildSalesReport(
  sales: ReportSale[],
  refunds: ReportRefund[],
  lookups: ReportLookups,
) {
  const days = grouped<string, SalesFigures>(emptyFigures)
  lookups.days.forEach((day) => days.get(day))
  const totals = emptyFigures()
  const methods = grouped<string, { method: string; taken: number; refunded: number }>(() => ({
    method: '',
    taken: 0,
    refunded: 0,
  }))
  const products = grouped<
    number,
    {
      sku: string
      name: string
      quantity: number
      total: number
      refundedQuantity: number
      refunded: number
    }
  >(() => ({ sku: '', name: '', quantity: 0, total: 0, refundedQuantity: 0, refunded: 0 }))
  const categories = grouped<string, { quantity: number; total: number; refunded: number }>(() => ({
    quantity: 0,
    total: 0,
    refunded: 0,
  }))
  const cashiers = grouped<number, SalesFigures>(emptyFigures)
  const outlets = grouped<number, SalesFigures>(emptyFigures)

  for (const sale of sales) {
    addSale(days.get(zonedDay(sale.completedAt, lookups.timeZone)), sale)
    addSale(totals, sale)
    addSale(cashiers.get(sale.cashierId), sale)
    addSale(outlets.get(sale.outletId), sale)
    for (const p of netPayments(sale)) {
      const m = methods.get(p.methodCode)
      m.method = p.methodLabel
      m.taken += p.amount
    }
    for (const line of sale.lines) {
      const product = products.get(line.variantId)
      product.sku = line.sku
      product.name = line.name
      product.quantity += line.quantity
      product.total += line.total
      const category = categories.get(lookups.categoryOf(line.variantId) ?? 'Uncategorised')
      category.quantity += line.quantity
      category.total += line.total
    }
  }

  for (const refund of refunds) {
    addRefund(days.get(zonedDay(refund.createdAt, lookups.timeZone)), refund)
    addRefund(totals, refund)
    addRefund(cashiers.get(refund.processedById), refund)
    addRefund(outlets.get(refund.outletId), refund)
    for (const p of refund.payouts) {
      const m = methods.get(p.methodCode)
      m.method ||= p.methodLabel
      m.refunded += p.amount
    }
    for (const line of refund.lines) {
      const product = products.get(line.variantId)
      product.sku ||= line.sku
      product.name ||= line.name
      product.refundedQuantity += line.quantity
      product.refunded += line.total
      categories.get(lookups.categoryOf(line.variantId) ?? 'Uncategorised').refunded += line.total
    }
  }

  const byTotalDesc = <T extends { total: number }>(a: T, b: T) => b.total - a.total
  return {
    totals,
    byDay: days
      .entries()
      .map(([date, f]) => ({ date, ...f }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byPaymentMethod: methods
      .entries()
      .map(([code, m]) => ({
        code,
        method: m.method,
        taken: m.taken,
        refunded: m.refunded,
        net: m.taken - m.refunded,
      }))
      .sort((a, b) => b.taken - a.taken),
    byProduct: products
      .entries()
      .map(([variantId, p]) => ({ variantId, ...p, net: p.total - p.refunded }))
      .sort(byTotalDesc),
    byCategory: categories
      .entries()
      .map(([category, c]) => ({ category, ...c, net: c.total - c.refunded }))
      .sort(byTotalDesc),
    byCashier: cashiers
      .entries()
      .map(([id, f]) => ({ cashier: lookups.userName(id), ...f }))
      .sort(byTotalDesc),
    byOutlet: outlets
      .entries()
      .map(([id, f]) => ({ outlet: lookups.outletName(id), ...f }))
      .sort(byTotalDesc),
  }
}

export type SalesReport = ReturnType<typeof buildSalesReport>
