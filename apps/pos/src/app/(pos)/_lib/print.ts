'use client'

/**
 * Prints a receipt through a hidden iframe, so no popup window is needed (FR-43). The receipt page
 * opens the print dialog itself; `reprint` marks it "REPRINT" (FR-44).
 */
export function printReceipt(saleId: number, { reprint = false }: { reprint?: boolean } = {}) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.src = `/receipt/${saleId}?print=1${reprint ? '&reprint=1' : ''}`
  document.body.appendChild(frame)
  // Keep it long enough for the print dialog; remove it afterwards.
  setTimeout(() => frame.remove(), 60_000)
}
