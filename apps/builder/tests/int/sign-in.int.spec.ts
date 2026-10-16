import config from '@/payload.config'
import { signIn } from '@/endpoints/sign-in'
import { OWNER_SEED_CONTEXT } from '@/hooks/totp-login'
import { MAX_FAILED_LOGINS } from '@/lib/login-limit'
import { seedOwner } from '@/lib/seed-owner'
import { totpCode } from '@/lib/totp'
import type { User } from '@/payload-types'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { callEndpoint } from '../helpers/endpoint'

/** Owner sign-in with TOTP (BR-01), rate limiting (BR-02) and its audit trail (BR-04). */

const PASSWORD = 'correct-horse-battery-staple'
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const startedAt = new Date().toISOString()

let payload: Payload
let owner: User
let limited: User
const extraUsers: User[] = []
let secret: string
let ipCount = 0

/** A fresh client IP per call site, so IP limits from one test do not leak into another. */
const freshIp = () => `198.51.100.${(ipCount += 1)}`

const createOwner = (name: string) =>
  payload.create({
    collection: 'users',
    data: { email: `${name}-${run}@kiln.test`, password: PASSWORD },
    overrideAccess: true,
    context: { [OWNER_SEED_CONTEXT]: true },
  })

const attempt = (
  user: User,
  body: { password?: string; code?: string; enrolToken?: string } = {},
  ip = freshIp(),
) =>
  callEndpoint(payload, signIn, {
    headers: { 'x-forwarded-for': ip },
    body: { email: user.email, password: PASSWORD, code: '', ...body },
  })

const stored = (user: User) =>
  payload.findByID({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
    showHiddenFields: true,
  })

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  owner = await createOwner('owner')
  limited = await createOwner('limited')
})

afterAll(async () => {
  const users = [owner, limited, ...extraUsers]
  const emails = users.map((user) => user.email)
  await payload.delete({
    collection: 'login-attempts',
    where: { email: { in: emails } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'audit-log',
    where: {
      and: [{ entity: { equals: 'users' } }, { createdAt: { greater_than_equal: startedAt } }],
    },
    overrideAccess: true,
  })
  for (const user of users) {
    await payload.delete({ collection: 'users', id: user.id, overrideAccess: true })
  }
})

describe('closed doors', () => {
  it('refuses Payload’s own login, forgot-password and first-user creation', async () => {
    await expect(
      payload.login({ collection: 'users', data: { email: owner.email, password: PASSWORD } }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      payload.forgotPassword({ collection: 'users', data: { email: owner.email } }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      payload.create({
        collection: 'users',
        data: { email: `intruder-${run}@kiln.test`, password: PASSWORD },
        overrideAccess: true,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('does not seed another owner once one exists', async () => {
    expect(await seedOwner(payload, { NODE_ENV: 'production' })).toBe('has-owners')
  })
})

describe('first sign-in enrols an authenticator', () => {
  it('needs the right password before showing a set-up code', async () => {
    expect(await attempt(owner, { password: 'wrong-password' })).toMatchObject({
      status: 401,
      body: { error: { code: 'invalid_credentials' } },
    })
  })

  it('returns a QR code and token instead of a session', async () => {
    const result = await attempt(owner)
    expect(result.status).toBe(200)
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result.body.enrol).toMatchObject({
      token: expect.any(String),
      secret: expect.stringMatching(/^[A-Z2-7]{32}$/),
      qr: expect.stringMatching(/^data:image\/png;base64,/),
    })
    secret = result.body.enrol.secret
    expect((await stored(owner)).totpEnabled).toBe(false)

    expect(
      await attempt(owner, { enrolToken: result.body.enrol.token, code: '000000' }),
    ).toMatchObject({ status: 401 })

    const enrolled = await attempt(owner, {
      enrolToken: result.body.enrol.token,
      code: totpCode(secret),
    })
    expect(enrolled).toMatchObject({ status: 200, body: { user: { id: owner.id } } })
    expect(enrolled.headers.get('set-cookie')).toMatch(/payload-token=.+; .*HttpOnly/i)
  })

  it('stores the secret sealed, never in clear', async () => {
    const user = await stored(owner)
    expect(user.totpEnabled).toBe(true)
    expect(user.totpSecret).toMatch(/^v1\./)
    expect(user.totpSecret).not.toContain(secret)
  })

  it('rejects a forged or expired enrolment token', async () => {
    expect(await attempt(limited, { enrolToken: 'forged.token', code: '123456' })).toMatchObject({
      status: 400,
      body: { error: { code: 'enrolment_expired' } },
    })
  })
})

describe('signing in with a code', () => {
  // The enrolment used the current time step; the authenticator's next code is one step ahead.
  const nextCode = () => totpCode(secret, Date.now() + 30_000)

  it('refuses a missing or wrong code even with the right password', async () => {
    expect(await attempt(owner)).toMatchObject({ status: 401 })
    expect(await attempt(owner, { code: '000000' })).toMatchObject({ status: 401 })
  })

  it('accepts the next code once and issues a working session', async () => {
    const code = nextCode()
    const result = await attempt(owner, { code })
    expect(result.status).toBe(200)

    const cookie = result.headers.get('set-cookie')!.split(';')[0]!
    const auth = await payload.auth({ headers: new Headers({ cookie }) })
    expect(auth.user?.id).toBe(owner.id)

    // The same code cannot be replayed.
    expect(await attempt(owner, { code })).toMatchObject({ status: 401 })
  })

  it('audits successes and failures', async () => {
    const entries = await payload.find({
      collection: 'audit-log',
      where: {
        and: [
          { action: { in: ['sign_in', 'sign_in_failed', 'totp_enrolled'] } },
          { createdAt: { greater_than_equal: startedAt } },
        ],
      },
      pagination: false,
      overrideAccess: true,
    })
    const actions = entries.docs.map((entry) => entry.action)
    expect(actions).toEqual(expect.arrayContaining(['sign_in', 'sign_in_failed', 'totp_enrolled']))
    expect(JSON.stringify(entries.docs)).not.toContain(PASSWORD)
  })
})

describe('rate limit (BR-02)', () => {
  it('blocks an account after five failures, even from new addresses', async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      expect(await attempt(limited, { password: 'wrong-password' })).toMatchObject({ status: 401 })
    }
    expect(await attempt(limited)).toMatchObject({
      status: 429,
      body: { error: { code: 'too_many_attempts' } },
    })
  })

  it('blocks an address after five failures, whatever the account', async () => {
    const ip = freshIp()
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      await callEndpoint(payload, signIn, {
        headers: { 'x-forwarded-for': ip },
        body: { email: `nobody-${i}-${run}@kiln.test`, password: 'x' },
      })
    }
    // An account with no failures of its own, so only the address limit can apply.
    const fresh = await createOwner('fresh')
    extraUsers.push(fresh)
    const result = await attempt(fresh, {}, ip)
    expect(result).toMatchObject({ status: 429 })
    expect(result.headers.get('retry-after')).toBe('900')
    await payload.delete({
      collection: 'login-attempts',
      where: { ip: { equals: ip } },
      overrideAccess: true,
    })
  })
})
