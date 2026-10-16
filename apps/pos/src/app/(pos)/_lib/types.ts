import type { Discount } from '@kiln/pricing'

export type Role = 'admin' | 'manager' | 'cashier'

export interface TillUser {
  id: number
  name: string
  role: Role
}

/** Static data the server page hands to the till. */
export interface Bootstrap {
  deviceUser: TillUser
  settings: {
    displayName: string
    currency: string
    locale: string
    timezone: string
    pricesIncludeTax: boolean
    discountLimitPercent: number
    modules: { inventory: boolean; customers: boolean; discounts: boolean; multiOutlet: boolean }
    receipt: { paperWidthMm: 58 | 80; showTaxBreakdown: boolean; showCashierName: boolean }
  }
  branding: {
    primaryColor: string
    accentColor: string
    logoUrl: string | null
    receiptHeader: string | null
    receiptFooter: string | null
    legalName: string
    address: string | null
    phone: string | null
    taxRegistrationNo: string | null
  }
  registers: { id: number; code: string; name: string; outletId: number; outletName: string }[]
  paymentMethods: {
    id: number
    code: string
    label: string
    type: 'cash' | 'card_external' | 'qr' | 'other'
    requiresReference: boolean
  }[]
}

export interface CatalogueVariant {
  id: number
  name: string
  sku: string
  barcodes: string[]
  price: number
  taxRatePercent: number
  categoryId: number | null
}

export interface CatalogueCategory {
  id: number
  name: string
  parentId: number | null
  colour: string | null
}

export interface OpenShift {
  id: number
  openedAt: string
  openingFloat: number
  register: { id: number; code: string; name: string }
  outletId: number | null
}

export interface CartLine {
  key: string
  variantId: number
  name: string
  sku: string
  unitPrice: number
  taxRatePercent: number
  quantity: number
  discount?: Discount
}

export interface Cart {
  /** Idempotency key for finalising this cart (one per checkout). */
  clientRef: string
  lines: CartLine[]
  cartDiscount?: Discount
  customer?: { id: number; name: string }
  /** Set once a tender is entered; voiding lines then needs a manager (FR-13). */
  paymentStarted: boolean
}

export interface StaffMember {
  id: number
  name: string
  role: Role
  hasPin: boolean
}
