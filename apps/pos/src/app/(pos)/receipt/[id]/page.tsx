import { buildTaxBreakdown, formatMoney } from '@kiln/pricing'
import config from '@payload-config'
import { headers as getHeaders } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { formatDateTime } from '@/lib/dates'
import { isLicenceUsable } from '@/lib/licence'

import { Barcode, ReceiptActions } from './ReceiptActions'

/**
 * A browser-printed receipt at 58 or 80 mm (FR-43), with branding, tax breakdown and footer.
 * `?reprint=1` marks it "REPRINT" (FR-44); `?print=1` opens the print dialog on load. The sale is
 * read with the viewer's own access, so outlet scoping applies (FR-11).
 */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ reprint?: string; print?: string }>
}) {
  const { id } = await params
  const { reprint, print } = await searchParams
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  if (!user || user.collection !== 'users' || !isLicenceUsable()) notFound()

  const sale = await payload
    .findByID({ collection: 'sales', id: Number(id), depth: 1, overrideAccess: false, user })
    .catch(() => null)
  if (!sale) notFound()

  const [settings, branding] = await Promise.all([
    payload.findGlobal({ slug: 'system-settings', depth: 0, overrideAccess: true }),
    payload.findGlobal({ slug: 'branding', depth: 1, overrideAccess: true }),
  ])
  const money = (minor: number) => formatMoney(minor, settings.currency, settings.locale)
  const width = settings.receipt?.paperWidthMm === '58' ? 58 : 80
  const register = typeof sale.register === 'object' ? sale.register : null
  const cashier = typeof sale.cashier === 'object' ? sale.cashier : null
  const logo = typeof branding.logo === 'object' ? branding.logo : null
  const taxBreakdown = buildTaxBreakdown(
    sale.lines.map((line) => ({
      taxRatePercent: line.taxRatePercent,
      totalExcludingTax: line.total - line.tax,
      tax: line.tax,
    })),
  )

  return (
    <>
      <style>{`
        @page { size: ${width}mm auto; margin: 0; }
        html, body { background: #fff; }
        .receipt { width: ${width}mm; padding: 3mm ${width === 58 ? 2 : 4}mm; margin: 0 auto;
          font: ${width === 58 ? 11 : 12}px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #000; }
        .receipt h1 { font-size: 1.3em; font-weight: 700; text-align: center; margin: 0; }
        .receipt .c { text-align: center; } .receipt .r { text-align: right; }
        .receipt hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
        .receipt table { width: 100%; border-collapse: collapse; }
        .receipt td { vertical-align: top; padding: 0; }
        .receipt .big td { font-weight: 700; font-size: 1.2em; }
        .receipt .reprint { border: 2px solid #000; text-align: center; font-weight: 700; margin: 1mm 0; }
        @media screen { html, body { background: #f4f4f5; min-height: 100%; } .receipt { background: #fff; margin: 16px auto; box-shadow: 0 1px 4px #0002; } }
        @media print { .no-print { display: none !important; } }
      `}</style>
      <ReceiptActions autoPrint={print === '1'} />
      <article className="receipt" aria-label={`Receipt ${sale.receiptNumber}`}>
        {reprint === '1' && <div className="reprint">REPRINT</div>}
        {logo?.url && (
          // eslint-disable-next-line @next/next/no-img-element -- printed as-is from Payload media
          <img
            src={logo.url}
            alt=""
            style={{ display: 'block', maxWidth: '60%', maxHeight: '18mm', margin: '0 auto 1mm' }}
          />
        )}
        <h1>{settings.displayName}</h1>
        <div className="c">
          {settings.legalName !== settings.displayName && <div>{settings.legalName}</div>}
          {settings.address && <div style={{ whiteSpace: 'pre-line' }}>{settings.address}</div>}
          {settings.phone && <div>{settings.phone}</div>}
          {settings.taxRegistrationNo && <div>Tax reg. {settings.taxRegistrationNo}</div>}
          {branding.receiptHeader && (
            <div style={{ whiteSpace: 'pre-line' }}>{branding.receiptHeader}</div>
          )}
        </div>
        <hr />
        <table>
          <tbody>
            <tr>
              <td>Receipt</td>
              <td className="r">{sale.receiptNumber}</td>
            </tr>
            <tr>
              <td>Date</td>
              <td className="r">
                {formatDateTime(sale.completedAt, {
                  pattern: settings.dateFormat,
                  timeZone: settings.timezone,
                })}
              </td>
            </tr>
            {register && (
              <tr>
                <td>Register</td>
                <td className="r">{register.name}</td>
              </tr>
            )}
            {settings.receipt?.showCashierName !== false && cashier && (
              <tr>
                <td>Cashier</td>
                <td className="r">{cashier.name}</td>
              </tr>
            )}
          </tbody>
        </table>
        <hr />
        <table>
          <tbody>
            {sale.lines.map((line) => (
              <React.Fragment key={line.id}>
                <tr>
                  <td colSpan={2}>{line.name}</td>
                </tr>
                <tr>
                  <td>
                    &nbsp;&nbsp;{line.quantity} × {money(line.unitPrice)}
                  </td>
                  <td className="r">{money(line.gross)}</td>
                </tr>
                {line.lineDiscount + line.cartDiscount > 0 && (
                  <tr>
                    <td>&nbsp;&nbsp;Discount</td>
                    <td className="r">−{money(line.lineDiscount + line.cartDiscount)}</td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <hr />
        <table>
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="r">{money(sale.subtotal)}</td>
            </tr>
            {sale.discountTotal > 0 && (
              <tr>
                <td>Discounts</td>
                <td className="r">−{money(sale.discountTotal)}</td>
              </tr>
            )}
            {!sale.pricesIncludeTax && (
              <tr>
                <td>Tax</td>
                <td className="r">{money(sale.taxTotal)}</td>
              </tr>
            )}
            <tr className="big">
              <td>TOTAL</td>
              <td className="r">{money(sale.total)}</td>
            </tr>
            {sale.payments.map((payment) => (
              <tr key={payment.id}>
                <td>
                  {payment.methodLabel}
                  {payment.reference && ` (${payment.reference})`}
                </td>
                <td className="r">{money(payment.amount)}</td>
              </tr>
            ))}
            {sale.change > 0 && (
              <tr>
                <td>Change</td>
                <td className="r">{money(sale.change)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {settings.receipt?.showTaxBreakdown !== false && (
          <>
            <hr />
            <table>
              <tbody>
                <tr>
                  <td>{sale.pricesIncludeTax ? 'Tax included' : 'Tax'}</td>
                  <td className="r">Net</td>
                  <td className="r">Tax</td>
                </tr>
                {taxBreakdown.map((entry) => (
                  <tr key={entry.taxRatePercent}>
                    <td>{entry.taxRatePercent}%</td>
                    <td className="r">{money(entry.taxableAmount)}</td>
                    <td className="r">{money(entry.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <hr />
        {branding.receiptFooter && (
          <p className="c" style={{ whiteSpace: 'pre-line', margin: '0 0 2mm' }}>
            {branding.receiptFooter}
          </p>
        )}
        <Barcode value={sale.receiptNumber} width={width} />
      </article>
    </>
  )
}
