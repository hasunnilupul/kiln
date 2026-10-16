import config from '@/payload.config'
import { closeShift, openShift, recordCashMovement, shiftSummary } from '@/endpoints/pos/shifts'
import { getLicenceState, setLicenceState } from '@/lib/licence'
import type { Outlet, Register, User } from '@/payload-types'
import { getPayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { Fixtures, callEndpoint } from '../helpers/fixtures'

/** Shift endpoints (FR-60, FR-61, FR-62). */

let payload: Payload
let fx: Fixtures
let outletA: Outlet
let outletB: Outlet
let registerA: Register
let registerB: Register
let cashier: User
let cashier2: User
let manager: User
const licence = getLicenceState()

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  fx = new Fixtures(payload)
  outletA = await fx.outlet('A')
  outletB = await fx.outlet('B')
  registerA = await fx.register(outletA)
  registerB = await fx.register(outletB)
  cashier = await fx.user('cashier', [outletA])
  cashier2 = await fx.user('cashier', [outletA])
  manager = await fx.user('manager', [outletA])
})

afterAll(() => fx.cleanup())
afterEach(() => setLicenceState(licence))

async function open(user: User, registerId: number, openingFloat = 10000) {
  const result = await callEndpoint(payload, openShift, {
    user,
    body: { registerId, openingFloat },
  })
  if (result.status === 201) fx.track('shifts', result.body.id)
  return result
}

describe('POST /api/pos/shifts/open (FR-60)', () => {
  it('requires sign-in', async () => {
    const result = await callEndpoint(payload, openShift, {
      body: { registerId: registerA.id, openingFloat: 0 },
    })
    expect(result).toMatchObject({ status: 401, body: { error: { code: 'unauthenticated' } } })
  })

  it('validates the body', async () => {
    const result = await callEndpoint(payload, openShift, {
      user: cashier,
      body: { registerId: registerA.id, openingFloat: 10.5 },
    })
    expect(result).toMatchObject({ status: 400, body: { error: { code: 'invalid_request' } } })
  })

  it('refuses registers in other outlets', async () => {
    expect(await open(cashier, registerB.id)).toMatchObject({
      status: 403,
      body: { error: { code: 'outlet_forbidden' } },
    })
  })

  it('refuses inactive registers', async () => {
    const inactive = await fx.register(outletA, { active: false })
    expect(await open(cashier, inactive.id)).toMatchObject({
      status: 409,
      body: { error: { code: 'register_inactive' } },
    })
  })

  it('refuses registers beyond the licence limit (FR-04)', async () => {
    const extra = await fx.register(outletA)
    const active = await payload.count({
      collection: 'registers',
      where: { active: { equals: true } },
    })
    setLicenceState({
      status: 'valid',
      checkedAt: new Date().toISOString(),
      licence: {
        version: 1,
        licenceId: 'lic',
        clientId: 'cl',
        allowedHosts: ['localhost'],
        modules: [],
        maxRegisters: active.totalDocs - 1,
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    })
    expect(await open(cashier, extra.id)).toMatchObject({
      status: 403,
      body: { error: { code: 'register_not_licensed' } },
    })
  })

  it('opens one shift per register and per cashier', async () => {
    const opened = await open(cashier, registerA.id, 15000)
    expect(opened).toMatchObject({
      status: 201,
      body: { status: 'open', openingFloat: 15000, cashier: cashier.id, register: registerA.id },
    })
    expect(await open(cashier2, registerA.id)).toMatchObject({
      status: 409,
      body: { error: { code: 'register_has_open_shift' } },
    })
    const other = await fx.register(outletA)
    expect(await open(cashier, other.id)).toMatchObject({
      status: 409,
      body: { error: { code: 'cashier_has_open_shift' } },
    })
  })

  it('opens exactly one shift when cashiers race for a register', async () => {
    const register = await fx.register(outletA)
    const racers = await Promise.all([1, 2, 3, 4].map(() => fx.user('cashier', [outletA])))
    const results = await Promise.all(racers.map((racer) => open(racer, register.id)))
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(3)
  })
})

describe('cash movements and closing (FR-61, FR-62)', () => {
  let shiftId: number
  let closer: User

  beforeAll(async () => {
    const register = await fx.register(outletA)
    closer = await fx.user('cashier', [outletA])
    const opened = await open(closer, register.id, 10000)
    shiftId = opened.body.id
  })

  it('lets only managers move cash', async () => {
    const body = { type: 'in', amount: 5000, reason: 'Extra change' }
    expect(
      await callEndpoint(payload, recordCashMovement, {
        user: closer,
        body,
        params: { id: shiftId },
      }),
    ).toMatchObject({ status: 403 })

    const added = await callEndpoint(payload, recordCashMovement, {
      user: manager,
      body,
      params: { id: shiftId },
    })
    expect(added).toMatchObject({ status: 201, body: { type: 'in', amount: 5000 } })
    fx.track('cash-movements', added.body.id)

    const out = await callEndpoint(payload, recordCashMovement, {
      user: manager,
      body: { type: 'out', amount: 1200, reason: 'Supplier' },
      params: { id: shiftId },
    })
    fx.track('cash-movements', out.body.id)
  })

  it('shows a running summary to the shift’s cashier', async () => {
    const result = await callEndpoint(payload, shiftSummary, {
      user: closer,
      params: { id: shiftId },
    })
    expect(result).toMatchObject({ status: 200, body: { summary: { expectedCash: 13800 } } })
  })

  it('lets only the shift’s cashier or a manager close it', async () => {
    expect(
      await callEndpoint(payload, closeShift, {
        user: cashier2,
        body: { countedCash: 0 },
        params: { id: shiftId },
      }),
    ).toMatchObject({ status: 403, body: { error: { code: 'not_your_shift' } } })
  })

  it('closes with expected cash and variance, once', async () => {
    const closed = await callEndpoint(payload, closeShift, {
      user: closer,
      body: { countedCash: 13750 },
      params: { id: shiftId },
    })
    expect(closed).toMatchObject({
      status: 200,
      body: {
        shift: { status: 'closed', expectedCash: 13800, countedCash: 13750, variance: -50 },
        summary: { openingFloat: 10000, cashIn: 5000, cashOut: 1200, expectedCash: 13800 },
      },
    })
    expect(closed.body.shift.closedAt).toBeTruthy()

    expect(
      await callEndpoint(payload, closeShift, {
        user: closer,
        body: { countedCash: 1 },
        params: { id: shiftId },
      }),
    ).toMatchObject({ status: 409, body: { error: { code: 'shift_closed' } } })
    expect(
      await callEndpoint(payload, recordCashMovement, {
        user: manager,
        body: { type: 'in', amount: 1, reason: 'Late' },
        params: { id: shiftId },
      }),
    ).toMatchObject({ status: 409 })
  })

  it('returns 404 for unknown shifts', async () => {
    expect(
      await callEndpoint(payload, closeShift, {
        user: manager,
        body: { countedCash: 0 },
        params: { id: 999999999 },
      }),
    ).toMatchObject({ status: 404 })
  })
})
