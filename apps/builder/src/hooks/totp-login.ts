import {
  AuthenticationError,
  Forbidden,
  type CollectionBeforeLoginHook,
  type CollectionBeforeOperationHook,
  type PayloadRequest,
} from 'payload'

import { execute, sql } from '../lib/db'
import { seal, unseal } from '../lib/secrets'
import { verifyTotp } from '../lib/totp'

/** `req.context` key set only by the sign-in endpoint and by owner seeding. */
export const SIGN_IN_CONTEXT = 'kilnSignIn'
export const OWNER_SEED_CONTEXT = 'kilnOwnerSeed'

/** Purpose string for sealing TOTP secrets with `PAYLOAD_SECRET`. */
export const TOTP_SECRET_PURPOSE = 'totp-secret'

export interface SignInContext {
  code: string
  /** A secret the owner is enrolling, from a verified enrolment token for this user. */
  enrol?: { userId: number; secret: string }
}

/** The password was right; the owner now has to enter the code from their authenticator. */
export class TotpCodeRequired extends Error {
  constructor() {
    super('TOTP code required')
    this.name = 'TotpCodeRequired'
  }
}

/** The password was right, but the owner has no authenticator yet and must enrol one. */
export class TotpEnrolmentRequired extends Error {
  readonly userId: number

  constructor(userId: number) {
    super('TOTP enrolment required')
    this.name = 'TotpEnrolmentRequired'
    this.userId = userId
  }
}

function signInContext(req: PayloadRequest): SignInContext | undefined {
  return req.context[SIGN_IN_CONTEXT] as SignInContext | undefined
}

/**
 * Closes every way into an account that skips the TOTP check (BR-01): Payload's REST and admin
 * login, forgot/reset password, and the create-first-user screen. Owners come from seeding or
 * from another signed-in owner.
 */
export const blockUnverifiedAuth: CollectionBeforeOperationHook = ({ operation, req }) => {
  if (operation === 'forgotPassword' || operation === 'resetPassword') {
    throw new Forbidden(req.t)
  }
  if (operation === 'login' && !signInContext(req)) {
    throw new Forbidden(req.t)
  }
  if (operation === 'create' && !req.user && !req.context[OWNER_SEED_CONTEXT]) {
    throw new Forbidden(req.t)
  }
}

/**
 * Runs inside Payload's login after the password has been verified and before the session token
 * is issued; throwing here revokes the new session and rolls the login back. Checks the TOTP code,
 * or completes enrolment, and records the code's time step so it cannot be used again.
 */
export const checkTotpOnLogin: CollectionBeforeLoginHook = async ({ req, user }) => {
  const signIn = signInContext(req)
  if (!signIn) throw new Forbidden(req.t)

  const sealed = typeof user.totpSecret === 'string' && user.totpSecret ? user.totpSecret : null
  let secret: string
  if (sealed) {
    secret = unseal(sealed, req.payload.secret, TOTP_SECRET_PURPOSE)
  } else if (signIn.enrol && signIn.enrol.userId === user.id) {
    secret = signIn.enrol.secret
  } else {
    throw new TotpEnrolmentRequired(user.id)
  }

  // Credentials first, code second: an empty code after a correct password asks for the code.
  if (signIn.code.trim() === '') throw new TotpCodeRequired()

  const step = verifyTotp(secret, signIn.code, { lastUsedStep: user.totpLastStep })
  if (step === null) throw new AuthenticationError(req.t)

  // Conditional on the stored step, so two concurrent sign-ins cannot both use one code.
  const updated = await execute(
    req,
    sql`update users set totp_last_step = ${step},
          totp_secret = ${sealed ?? seal(secret, req.payload.secret, TOTP_SECRET_PURPOSE)},
          totp_enabled = true
        where id = ${user.id} and (totp_last_step is null or totp_last_step < ${step})
        returning id`,
  )
  if (updated.length !== 1) throw new AuthenticationError(req.t)

  return { ...user, totpEnabled: true, totpLastStep: step }
}
