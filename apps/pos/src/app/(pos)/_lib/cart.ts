import { calculateCart, type CartTotals, type Discount } from '@kiln/pricing'

import type { Cart, CartLine, CatalogueVariant } from './types'

export function emptyCart(): Cart {
  return { clientRef: crypto.randomUUID(), lines: [], paymentStarted: false }
}

export type CartAction =
  | { type: 'add'; variant: CatalogueVariant; quantity?: number }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'remove'; key: string }
  | { type: 'lineDiscount'; key: string; discount?: Discount }
  | { type: 'cartDiscount'; discount?: Discount }
  | { type: 'customer'; customer?: { id: number; name: string } }
  | { type: 'paymentStarted' }
  | { type: 'replace'; cart: Cart }
  | { type: 'clear' }

/** Cart state on the till. Scanning an item already in the cart (without a discount) adds one. */
export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'add': {
      const quantity = action.quantity ?? 1
      const existing = cart.lines.find((l) => l.variantId === action.variant.id && !l.discount)
      if (existing) {
        return {
          ...cart,
          lines: cart.lines.map((l) =>
            l === existing ? { ...l, quantity: l.quantity + quantity } : l,
          ),
        }
      }
      const line: CartLine = {
        key: crypto.randomUUID(),
        variantId: action.variant.id,
        name: action.variant.name,
        sku: action.variant.sku,
        unitPrice: action.variant.price,
        taxRatePercent: action.variant.taxRatePercent,
        quantity,
      }
      return { ...cart, lines: [...cart.lines, line] }
    }
    case 'setQuantity':
      return {
        ...cart,
        lines: cart.lines.map((l) =>
          l.key === action.key ? { ...l, quantity: Math.max(1, Math.floor(action.quantity)) } : l,
        ),
      }
    case 'remove':
      return { ...cart, lines: cart.lines.filter((l) => l.key !== action.key) }
    case 'lineDiscount':
      return {
        ...cart,
        lines: cart.lines.map((l) =>
          l.key === action.key ? { ...l, discount: action.discount } : l,
        ),
      }
    case 'cartDiscount':
      return { ...cart, cartDiscount: action.discount }
    case 'customer':
      return { ...cart, customer: action.customer }
    case 'paymentStarted':
      return { ...cart, paymentStarted: true }
    case 'replace':
      return action.cart
    case 'clear':
      return emptyCart()
  }
}

/** Display totals; the server recomputes everything at finalisation (FR-32). */
export function priceCart(
  cart: Cart,
  pricesIncludeTax: boolean,
): { totals?: CartTotals; error?: string } {
  try {
    return {
      totals: calculateCart({
        pricesIncludeTax,
        lines: cart.lines.map((l) => ({
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          taxRatePercent: l.taxRatePercent,
          discount: l.discount,
        })),
        cartDiscount: cart.cartDiscount,
      }),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Cannot price the cart' }
  }
}

/** Finds a variant by exact barcode or SKU, as typed by a keyboard-wedge scanner (FR-30). */
export function indexCatalogue(variants: CatalogueVariant[]) {
  const byCode = new Map<string, CatalogueVariant>()
  for (const variant of variants) {
    byCode.set(variant.sku.toLowerCase(), variant)
    for (const barcode of variant.barcodes) byCode.set(barcode.toLowerCase(), variant)
  }
  const searchable = variants.map((v) => ({ variant: v, text: `${v.name} ${v.sku}`.toLowerCase() }))
  return {
    lookup: (code: string) => byCode.get(code.trim().toLowerCase()),
    search: (query: string, limit = 40) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      if (terms.length === 0) return []
      const results: CatalogueVariant[] = []
      for (const entry of searchable) {
        if (terms.every((t) => entry.text.includes(t))) {
          results.push(entry.variant)
          if (results.length >= limit) break
        }
      }
      return results
    },
  }
}

const PARKED_PREFIX = 'kiln:parked:'

export interface ParkedCart {
  cart: Cart
  parkedAt: string
}

/** Parked carts live on this till, per register (FR-34). */
export function loadParked(registerId: number): ParkedCart[] {
  try {
    return JSON.parse(localStorage.getItem(`${PARKED_PREFIX}${registerId}`) ?? '[]') as ParkedCart[]
  } catch {
    return []
  }
}

const PARKED_EVENT = 'kiln:parked'

export function saveParked(registerId: number, parked: ParkedCart[]) {
  try {
    localStorage.setItem(`${PARKED_PREFIX}${registerId}`, JSON.stringify(parked))
    window.dispatchEvent(new Event(PARKED_EVENT))
  } catch {
    // Storage full or blocked: parking is unavailable on this device.
  }
}

/** Calls `onChange` when parked carts change in this tab or another (`useSyncExternalStore`). */
export function subscribeParked(onChange: () => void): () => void {
  window.addEventListener(PARKED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(PARKED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}
