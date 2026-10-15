import config from '@/payload.config'
import { openShift } from '@/endpoints/pos/shifts'
import { listStaff, resetPin, setOwnPin, switchUser } from '@/endpoints/pos/staff'
import { verifyManagerApproval } from '@/lib/approvals'
import { ACTING_HEADER, resetPinAttempts } from '@/lib/pin'
import type { Outlet, User } from '@/payload-types'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Fixtures, asUser, callEndpoint } from '../helpers/fixtures'

/** PINs, switching user and manager approvals (FR-12, FR-13). */

let payload: Payload
let fx: Fixtures
let outletA: Outlet
let outletB: Outlet
let admin: User
let device: User
let colleague: User
let manager: User
let otherManager: User

const setPin = (user: User, pin: string, password = 'correct-horse-battery') =>
  callEndpoint(payload, setOwnPin, { user, body: { password, pin } })

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  fx = new Fixtures(payload)
  outletA = await fx.outlet('A')
  outletB = await fx.outlet('B')
  admin = await fx.user('admin', [])
  device = await fx.user('cashier', [outletA])
  colleague = await fx.user('cashier', [outletA])
  manager = await fx.user('manager', [outletA])
  otherManager = await fx.user('manager', [outletB])
})

afterAll(() => fx.cleanup())
beforeEach(() => resetPinAttempts())

describe('setting a PIN', () => {
  it('requires the current password', async () => {
    expect(await setPin(colleague, '4321', 'wrong-password')).toMatchObject({
      status: 403,
      body: { error: { code: 'wrong_password' } },
    })
  })

  it('rejects malformed PINs', async () => {
    expect(await setPin(colleague, '12')).toMatchObject({ status: 400 })
  })

  it('stores only a hash', async () => {
    expect(await setPin(colleague, '4321')).toMatchObject({ status: 200 })
    expect(await setPin(manager, '9999')).toMatchObject({ status: 200 })
    expect(await setPin(otherManager, '8888')).toMatchObject({ status: 200 })
    const stored = await payload.findByID({
      collection: 'users',
      id: colleague.id,
      overrideAccess: true,
      showHiddenFields: true,
    })
    expect(stored.pinHash).toMatch(/^scrypt\$/)
  })

  it('lists staff the device user works with, without PINs', async () => {
    const result = await callEndpoint(payload, listStaff, { user: device })
    const ids = result.body.staff.map((s: { id: number }) => s.id)
    expect(ids).toEqual(expect.arrayContaining([device.id, colleague.id, manager.id]))
    expect(ids).not.toContain(otherManager.id)
    expect(result.body.staff.find((s: { id: number }) => s.id === colleague.id)).toEqual({
      id: colleague.id,
      name: colleague.name,
      role: 'cashier',
      hasPin: true,
    })
  })
})

describe('switching user (FR-12)', () => {
  it('rejects a wrong PIN and locks after five tries', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(
        await callEndpoint(payload, switchUser, {
          user: device,
          body: { userId: colleague.id, pin: '0000' },
        }),
      ).toMatchObject({ status: 403 })
    }
    expect(
      await callEndpoint(payload, switchUser, {
        user: device,
        body: { userId: colleague.id, pin: '4321' },
      }),
    ).toMatchObject({ status: 429, body: { error: { code: 'pin_locked' } } })
  })

  it('refuses staff from other outlets', async () => {
    expect(
      await callEndpoint(payload, switchUser, {
        user: device,
        body: { userId: otherManager.id, pin: '8888' },
      }),
    ).toMatchObject({ status: 403 })
  })

  it('acts as the colleague on later requests', async () => {
    const switched = await callEndpoint(payload, switchUser, {
      user: device,
      body: { userId: colleague.id, pin: '4321' },
    })
    expect(switched).toMatchObject({ status: 200, body: { user: { id: colleague.id } } })

    const register = await fx.register(outletA)
    const opened = await callEndpoint(payload, openShift, {
      user: device,
      headers: { [ACTING_HEADER]: switched.body.token },
      body: { registerId: register.id, openingFloat: 0 },
    })
    expect(opened).toMatchObject({ status: 201, body: { cashier: colleague.id } })
    fx.track('shifts', opened.body.id)

    // The token only works with the device session that obtained it.
    expect(
      await callEndpoint(payload, openShift, {
        user: manager,
        headers: { [ACTING_HEADER]: switched.body.token },
        body: { registerId: register.id, openingFloat: 0 },
      }),
    ).toMatchObject({ status: 401, body: { error: { code: 'acting_user_expired' } } })
  })
})

describe('manager approval (FR-13)', () => {
  const approve = async (managerId: number, pin: string) => {
    const req = await createLocalReq({ user: asUser(device) }, payload)
    return verifyManagerApproval(
      req,
      asUser(device),
      { managerId, pin },
      {
        outletId: outletA.id,
        action: 'test_approval',
        details: { run: fx.run },
      },
    )
  }

  it('requires an approval', async () => {
    const req = await createLocalReq({ user: asUser(device) }, payload)
    await expect(
      verifyManagerApproval(req, asUser(device), undefined, { outletId: outletA.id, action: 'x' }),
    ).rejects.toMatchObject({ code: 'approval_required' })
  })

  it('rejects cashiers, wrong PINs and managers from other outlets', async () => {
    await expect(approve(colleague.id, '4321')).rejects.toMatchObject({ code: 'approval_denied' })
    await expect(approve(manager.id, '0000')).rejects.toMatchObject({ code: 'approval_denied' })
    await expect(approve(otherManager.id, '8888')).rejects.toMatchObject({
      code: 'approval_denied',
    })
  })

  it('accepts the outlet’s manager and audits it', async () => {
    const approver = await approve(manager.id, '9999')
    expect(approver.id).toBe(manager.id)
    const audit = await payload.find({
      collection: 'audit-log',
      where: { action: { equals: 'approval' }, entity: { equals: 'test_approval' } },
      sort: '-createdAt',
      limit: 1,
      overrideAccess: true,
    })
    expect(audit.docs[0]?.data).toMatchObject({
      approvedBy: manager.id,
      requestedBy: device.id,
      run: fx.run,
    })
    await payload.delete({ collection: 'audit-log', id: audit.docs[0]!.id, overrideAccess: true })
  })
})

describe('resetting a PIN', () => {
  it('is admin-only', async () => {
    expect(
      await callEndpoint(payload, resetPin, { user: manager, params: { id: colleague.id } }),
    ).toMatchObject({
      status: 403,
    })
    expect(
      await callEndpoint(payload, resetPin, { user: admin, params: { id: colleague.id } }),
    ).toMatchObject({
      status: 200,
    })
    const result = await callEndpoint(payload, listStaff, { user: device })
    expect(result.body.staff.find((s: { id: number }) => s.id === colleague.id).hasPin).toBe(false)
  })
})
