import config from '@/payload.config'
import type { Outlet, Register, TaxRate, User } from '@/payload-types'
import { getPayload, type CollectionSlug, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Access control (FR-10, FR-11, FR-03) through the Local API with `overrideAccess: false`,
 * which applies the same rules as REST and the admin panel. Fixtures use a unique suffix and
 * are removed afterwards, so the suite can run against a development database.
 */

let payload: Payload
const run = Date.now().toString(36).toUpperCase()
const created: { collection: CollectionSlug; id: number }[] = []

let outletA: Outlet
let outletB: Outlet
let registerA: Register
let registerB: Register
let taxRate: TaxRate
let admin: User
let manager: User
let cashier: User
let newcomer: User

/** The shape Payload gives `req.user`. */
const as = (user: User) => ({ ...user, collection: 'users' as const })

async function make<T>(collection: CollectionSlug, data: Record<string, unknown>): Promise<T> {
  const doc = await payload.create({ collection, data: data as never, overrideAccess: true })
  created.push({ collection, id: doc.id as number })
  return doc as T
}

let userCount = 0

function makeUser(role: User['role'], outlets: Outlet[], mustChangePassword = false) {
  userCount += 1
  return make<User>('users', {
    email: `${role}-${userCount}-${run}@kiln.test`.toLowerCase(),
    password: 'correct-horse-battery',
    name: `${role} ${run}`,
    role,
    outlets: outlets.map((o) => o.id),
    mustChangePassword,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  outletA = await make('outlets', { code: `A${run}`, name: 'Outlet A' })
  outletB = await make('outlets', { code: `B${run}`, name: 'Outlet B' })
  registerA = await make('registers', { code: `RA${run}`, name: 'Till A', outlet: outletA.id })
  registerB = await make('registers', { code: `RB${run}`, name: 'Till B', outlet: outletB.id })
  taxRate = await make('tax-rates', { code: `T${run}`, name: 'Test rate', ratePercent: 18 })
  admin = await makeUser('admin', [])
  manager = await makeUser('manager', [outletA])
  cashier = await makeUser('cashier', [outletA])
  newcomer = await makeUser('manager', [outletA], true)
})

afterAll(async () => {
  const ids = created.map((doc) => String(doc.id))
  await payload.delete({
    collection: 'audit-log',
    where: { entityId: { in: ids } },
    overrideAccess: true,
  })
  for (const doc of created.reverse()) {
    await payload.delete({ collection: doc.collection, id: doc.id, overrideAccess: true })
  }
})

describe('outlet scoping (FR-11)', () => {
  const registerIds = async (user: User) => {
    const result = await payload.find({
      collection: 'registers',
      where: { id: { in: [registerA.id, registerB.id] } },
      overrideAccess: false,
      user: as(user),
    })
    return result.docs.map((doc) => doc.id).sort()
  }

  it('admins see registers in every outlet', async () => {
    expect(await registerIds(admin)).toEqual([registerA.id, registerB.id].sort())
  })

  it('managers and cashiers see only their outlets', async () => {
    expect(await registerIds(manager)).toEqual([registerA.id])
    expect(await registerIds(cashier)).toEqual([registerA.id])
  })

  it('users without outlets are denied', async () => {
    const loner = await makeUser('manager', [])
    await expect(registerIds(loner)).rejects.toThrow(/not allowed/i)
  })
})

describe('users (FR-10)', () => {
  const visibleUsers = async (user: User) => {
    const result = await payload.find({
      collection: 'users',
      where: { id: { in: [admin.id, manager.id, cashier.id] } },
      overrideAccess: false,
      user: as(user),
    })
    return result.docs.map((doc) => doc.id).sort()
  }

  it('cashiers see only themselves', async () => {
    expect(await visibleUsers(cashier)).toEqual([cashier.id])
  })

  it('managers see staff in their outlets', async () => {
    expect(await visibleUsers(manager)).toEqual([manager.id, cashier.id].sort())
  })

  it('only admins create users', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: {
          email: `x-${run}@kiln.test`.toLowerCase(),
          password: 'x-password-1',
          name: 'X',
          role: 'admin',
        },
        overrideAccess: false,
        user: as(manager),
      }),
    ).rejects.toThrow()
  })

  it('users cannot change their own role', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: cashier.id,
      data: { role: 'admin', name: 'Renamed cashier' },
      overrideAccess: false,
      user: as(cashier),
    })
    expect(updated.role).toBe('cashier')
    expect(updated.name).toBe('Renamed cashier')
  })

  it('admins cannot demote or delete themselves', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: admin.id,
      data: { role: 'cashier' },
      overrideAccess: false,
      user: as(admin),
    })
    expect(updated.role).toBe('admin')
    await expect(
      payload.delete({ collection: 'users', id: admin.id, overrideAccess: false, user: as(admin) }),
    ).rejects.toThrow()
  })

  it('never exposes the PIN hash', async () => {
    const found = await payload.findByID({
      collection: 'users',
      id: cashier.id,
      overrideAccess: false,
      user: as(admin),
    })
    expect(found).not.toHaveProperty('pinHash')
  })
})

describe('forced password change (FR-03)', () => {
  it('blocks everything except the own account until the password changes', async () => {
    await expect(
      payload.find({ collection: 'products', overrideAccess: false, user: as(newcomer) }),
    ).rejects.toThrow()

    const updated = await payload.update({
      collection: 'users',
      id: newcomer.id,
      data: { password: 'a-brand-new-password' },
      overrideAccess: false,
      user: as(newcomer),
    })
    expect(updated.mustChangePassword).toBe(false)

    const products = await payload.find({
      collection: 'products',
      overrideAccess: false,
      user: as(updated),
    })
    expect(products).toBeDefined()
  })

  it('cannot clear the flag without changing the password', async () => {
    const pending = await makeUser('cashier', [outletA], true)
    const updated = await payload.update({
      collection: 'users',
      id: pending.id,
      data: { mustChangePassword: false },
      overrideAccess: false,
      user: as(pending),
    })
    expect(updated.mustChangePassword).toBe(true)
  })
})

describe('append-only records', () => {
  it.each<CollectionSlug>([
    'sales',
    'refunds',
    'stock-movements',
    'stock-levels',
    'shifts',
    'cash-movements',
    'audit-log',
  ])('even admins cannot create %s through the API', async (collection) => {
    await expect(
      payload.create({ collection, data: {} as never, overrideAccess: false, user: as(admin) }),
    ).rejects.toThrow(/not allowed/i)
  })

  it('register sale numbers cannot be set through the API', async () => {
    const updated = await payload.update({
      collection: 'registers',
      id: registerA.id,
      data: { nextSaleNumber: 999 },
      overrideAccess: false,
      user: as(admin),
    })
    expect(updated.nextSaleNumber).toBe(1)
  })
})

describe('settings', () => {
  it('only admins edit tax rates, and every change is audited', async () => {
    await expect(
      payload.update({
        collection: 'tax-rates',
        id: taxRate.id,
        data: { ratePercent: 15 },
        overrideAccess: false,
        user: as(manager),
      }),
    ).rejects.toThrow()

    await payload.update({
      collection: 'tax-rates',
      id: taxRate.id,
      data: { ratePercent: 15 },
      overrideAccess: false,
      user: as(admin),
    })
    const audit = await payload.find({
      collection: 'audit-log',
      where: {
        entity: { equals: 'tax-rates' },
        entityId: { equals: String(taxRate.id) },
        action: { equals: 'update' },
      },
      overrideAccess: true,
    })
    expect(audit.docs[0]).toMatchObject({ data: { ratePercent: { from: 18, to: 15 } } })
  })

  it('rejects fractional money and bad percentages', async () => {
    const product = await make<{ id: number }>('products', {
      name: 'Widget',
      sku: `W${run}`,
      taxRate: taxRate.id,
    })
    await expect(
      payload.create({
        collection: 'product-variants',
        data: { product: product.id, name: 'Widget', sku: `WV${run}`, price: 12.5 },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({
      data: { errors: [{ path: 'price', message: expect.stringMatching(/minor units/) }] },
    })
    await expect(
      payload.update({
        collection: 'tax-rates',
        id: taxRate.id,
        data: { ratePercent: 7.12345 },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({
      data: { errors: [{ path: 'ratePercent', message: expect.stringMatching(/decimal places/) }] },
    })
  })
})
