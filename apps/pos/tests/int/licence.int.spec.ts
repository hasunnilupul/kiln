import config from '@/payload.config'
import { health } from '@/endpoints/health'
import { getLicenceState, setLicenceState, type LicenceState } from '@/lib/licence'
import type { User } from '@/payload-types'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Licence enforcement (FR-04) and the health endpoint against a real Payload instance. */

let payload: Payload
let admin: User
let initialState: LicenceState | undefined
const run = Date.now().toString(36)

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  initialState = getLicenceState()
  admin = await payload.create({
    collection: 'users',
    data: {
      email: `licence-admin-${run}@kiln.test`,
      password: 'correct-horse-battery',
      name: 'Licence Admin',
      role: 'admin',
      mustChangePassword: false,
    },
    overrideAccess: true,
  })
})

afterAll(async () => {
  setLicenceState(initialState)
  await payload.delete({ collection: 'users', id: admin.id, overrideAccess: true })
  await payload.delete({
    collection: 'audit-log',
    where: { entityId: { equals: String(admin.id) } },
    overrideAccess: true,
  })
})

const asAdmin = () => ({ overrideAccess: false, user: { ...admin, collection: 'users' as const } })

async function callHealth() {
  const response = await health.handler(await createLocalReq({}, payload))
  return { status: response.status, body: await response.json() }
}

describe('licence enforcement', () => {
  it('checks the licence on startup; tests run unlicensed in development', () => {
    expect(initialState?.status).toBe('unlicensed-development')
  })

  it('denies all access while the licence is invalid, even to admins', async () => {
    await expect(payload.find({ collection: 'outlets', ...asAdmin() })).resolves.toBeDefined()

    setLicenceState({
      status: 'invalid',
      reason: 'expired',
      message: 'Licence expired',
      checkedAt: new Date().toISOString(),
    })
    await expect(payload.find({ collection: 'outlets', ...asAdmin() })).rejects.toThrow(
      /not allowed/i,
    )
    await expect(payload.findGlobal({ slug: 'system-settings', ...asAdmin() })).rejects.toThrow(
      /not allowed/i,
    )

    setLicenceState(initialState)
    await expect(payload.find({ collection: 'outlets', ...asAdmin() })).resolves.toBeDefined()
  })
})

describe('GET /api/health', () => {
  it('reports app, database and licence status', async () => {
    expect(await callHealth()).toEqual({
      status: 200,
      body: { app: 'ok', database: 'ok', licence: { status: 'unlicensed-development' } },
    })
  })

  it('returns 503 with the reason while the licence is invalid', async () => {
    setLicenceState({
      status: 'invalid',
      reason: 'host_not_allowed',
      message: 'Host "copy.example" is not licensed',
      checkedAt: '2027-01-01T00:00:00.000Z',
    })
    expect(await callHealth()).toEqual({
      status: 503,
      body: {
        app: 'ok',
        database: 'ok',
        licence: {
          status: 'invalid',
          reason: 'host_not_allowed',
          checkedAt: '2027-01-01T00:00:00.000Z',
        },
      },
    })
    setLicenceState(initialState)
  })
})
