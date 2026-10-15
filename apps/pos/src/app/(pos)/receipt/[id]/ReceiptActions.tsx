'use client'

import JsBarcode from 'jsbarcode'
import React, { useEffect, useRef } from 'react'

/** Opens the print dialog once the receipt has rendered, when asked to (FR-43). */
export function ReceiptActions({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return
    // Let the barcode and logo render before printing.
    const timer = setTimeout(() => window.print(), 300)
    return () => clearTimeout(timer)
  }, [autoPrint])

  return (
    <div className="no-print" style={{ textAlign: 'center', padding: 12 }}>
      <button
        type="button"
        onClick={() => window.print()}
        style={{ minHeight: 44, padding: '0 16px' }}
      >
        Print
      </button>
    </div>
  )
}

/** Code 128 barcode of the receipt number, scanned to find the sale for refunds (FR-50). */
export function Barcode({ value, width }: { value: string; width: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current) return
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      width: width === 58 ? 1.4 : 1.8,
      height: 40,
      margin: 0,
      fontSize: 12,
      displayValue: true,
    })
  }, [value, width])
  return (
    <svg
      ref={ref}
      role="img"
      aria-label={`Barcode ${value}`}
      style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}
    />
  )
}
