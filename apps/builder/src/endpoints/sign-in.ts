import { AuthenticationError, LockedAuth, type PayloadRequest, type Where } from 'payload'
import { generatePayloadCookie } from 'payload/shared'
import QRCode from 'qrcode'
import { z } from 'zod'

import { writeAudit } from '../hooks/audit'
import {
  SIGN_IN_CONTEXT,
  TotpCodeRequired,
  TotpEnrolmentRequired,
  type SignInContext,
} from '../hooks/totp-login'
import { clientIp } from '../lib/client-ip'
import {
  LOGIN_ATTEMPT_RETENTION_MS,
  LOGIN_WINDOW_MS,
  isLoginLimited,
  loginWindowStart,
} from '../lib/login-limit'
import { signToken, verifyToken } from '../lib/secrets'
import { generateTotpSecret, totpUri } from '../lib/totp'
import { ApiError, jsonEndpoint } from './http'

/** An enrolment token is valid this long: time to scan the QR code and type the first code. */
const ENROL_TTL_SECONDS = 10 * 60
const ENROL_PURPOSE = 'totp-enrol'

const signInBody = z.object({
  email: z
    .email()
    .max(254)
    .transform((email) => email.trim().toLowerCase()),
  password: z.string().min(1).max(1024),
  code: z.string().max(16).default(''),
  /** From an earlier `enrol` response, while the owner sets up their authenticator. */
  enrolToken: z.string().max(2048).optional(),
})

const enrolClaims = z.object({ userId: z.number().int().positive(), secret: z.string().min(16) })

async function failuresSince(req: PayloadRequest, ip: string | null, email: string) {
  const since = loginWindowStart().toISOString()
  const count = (where: Where) =>
    req.payload
      .count({
        collection: 'login-attempts',
        where: { and: [where, { createdAt: { greater_than: since } }] },
        overrideAccess: true,
      })
      .then((result) => result.totalDocs)
  const [byIp, byAccount] = await Promise.all([
    ip ? count({ ip: { equals: ip } }) : Promise.resolve(0),
    count({ email: { equals: email } }),
  ])
  return { byIp, byAccount }
}

/** Counts a failure towards the rate limit and drops attempts too old to matter. */
async function recordFailure(
  req: PayloadRequest,
  ip: string | null,
  email: string,
  reason: string,
) {
  await req.payload.create({
    collection: 'login-attempts',
    data: { ip, email },
    overrideAccess: true,
  })
  await req.payload.delete({
    collection: 'login-attempts',
    where: {
      createdAt: { less_than: new Date(Date.now() - LOGIN_ATTEMPT_RETENTION_MS).toISOString() },
    },
    overrideAccess: true,
  })
  await writeAudit(req, {
    action: 'sign_in_failed',
    entity: 'users',
    actor: null,
    data: { email, reason },
  })
}

/**
 * `POST /api/auth/sign-in`: email and password, then the TOTP code (BR-01), with at most 5 failures
 * per 15 minutes per IP and per account (BR-02). A correct password without a code returns
 * `{ codeRequired: true }`; the form then asks for the code and sends all three again. For an owner
 * without an authenticator, a correct password returns an `enrol` challenge (QR code and token)
 * instead; signing in again with the token and the app's first code enrols and signs in.
 */
export const signIn = jsonEndpoint({
  method: 'post',
  path: '/auth/sign-in',
  body: signInBody,
  handler: async (req, body) => {
    const ip = clientIp(req.headers)
    if (isLoginLimited(await failuresSince(req, ip, body.email))) {
      await writeAudit(req, {
        action: 'sign_in_limited',
        entity: 'users',
        actor: null,
        data: { email: body.email },
      })
      throw new ApiError(429, 'too_many_attempts', 'Too many failed sign-ins. Try again later.', {
        headers: { 'Retry-After': String(LOGIN_WINDOW_MS / 1000) },
      })
    }

    let enrol: SignInContext['enrol']
    if (body.enrolToken) {
      const claims = enrolClaims.safeParse(
        verifyToken(body.enrolToken, req.payload.secret, ENROL_PURPOSE),
      )
      if (!claims.success) {
        throw new ApiError(400, 'enrolment_expired', 'Set-up expired. Sign in again to restart it.')
      }
      enrol = claims.data
    }

    const context: SignInContext = { code: body.code, enrol }
    let result: Awaited<ReturnType<typeof req.payload.login<'users'>>>
    try {
      result = await req.payload.login({
        collection: 'users',
        data: { email: body.email, password: body.password },
        req,
        context: { [SIGN_IN_CONTEXT]: context },
      })
    } catch (error) {
      if (error instanceof TotpCodeRequired) {
        // Not a failure: the password was right and no code was sent yet.
        return { codeRequired: true }
      }
      if (error instanceof TotpEnrolmentRequired) {
        return enrolmentChallenge(req, error.userId, body.email)
      }
      if (error instanceof LockedAuth) {
        await recordFailure(req, ip, body.email, 'locked')
        throw new ApiError(423, 'account_locked', 'This account is locked. Try again in an hour.')
      }
      if (error instanceof AuthenticationError) {
        await recordFailure(req, ip, body.email, 'invalid_credentials')
        throw new ApiError(401, 'invalid_credentials', 'Email, password or code not accepted')
      }
      throw error
    }

    const { exp, token, user } = result
    if (!user || !token) throw new Error('Payload login returned no user or token')
    if (enrol) {
      await writeAudit(req, {
        action: 'totp_enrolled',
        entity: 'users',
        entityId: user.id,
        actor: user.id,
      })
    }
    await writeAudit(req, { action: 'sign_in', entity: 'users', entityId: user.id, actor: user.id })

    const cookie = generatePayloadCookie({
      collectionAuthConfig: req.payload.collections.users.config.auth,
      cookiePrefix: req.payload.config.cookiePrefix,
      token,
    })
    return Response.json(
      { user: { id: user.id, email: user.email }, exp },
      { headers: { 'Set-Cookie': cookie } },
    )
  },
})

/** A new secret to scan; it is stored only once the owner proves their app shows the right code. */
async function enrolmentChallenge(req: PayloadRequest, userId: number, email: string) {
  const secret = generateTotpSecret()
  const uri = totpUri(secret, email)
  const token = signToken({ userId, secret }, req.payload.secret, ENROL_PURPOSE, ENROL_TTL_SECONDS)
  await writeAudit(req, {
    action: 'totp_enrolment_started',
    entity: 'users',
    entityId: userId,
    actor: null,
  })
  return {
    enrol: { token, secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) },
  }
}

export const authEndpoints = [signIn]
