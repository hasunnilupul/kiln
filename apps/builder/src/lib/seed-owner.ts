import { createLocalReq, type Payload } from 'payload'
import { z } from 'zod'

import { OWNER_SEED_CONTEXT } from '../hooks/totp-login'
import { isBuildPhase, isProductionRuntime } from './runtime'

export const MIN_OWNER_PASSWORD_LENGTH = 16

const ownerEnv = z.object({
  BUILDER_OWNER_EMAIL: z.email(),
  BUILDER_OWNER_PASSWORD: z
    .string()
    .min(
      MIN_OWNER_PASSWORD_LENGTH,
      `BUILDER_OWNER_PASSWORD must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters`,
    ),
})

export type OwnerSeedResult = 'seeded' | 'has-owners' | 'no-env'

/**
 * Creates the first owner from `BUILDER_OWNER_EMAIL` and `BUILDER_OWNER_PASSWORD` when there is
 * none (BR-01: no self-signup). The owner sets up TOTP on their first sign-in, so sign in straight
 * after the first deploy. Later owners are added by a signed-in owner. Production refuses to start
 * without an owner; development only warns.
 */
export async function seedOwner(
  payload: Payload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnerSeedResult> {
  if (isBuildPhase(env)) return 'has-owners'
  const owners = await payload.count({ collection: 'users', overrideAccess: true })
  if (owners.totalDocs > 0) return 'has-owners'

  if (!env.BUILDER_OWNER_EMAIL && !env.BUILDER_OWNER_PASSWORD && !isProductionRuntime(env)) {
    payload.logger.warn(
      'No builder owner yet; set BUILDER_OWNER_EMAIL and BUILDER_OWNER_PASSWORD and restart',
    )
    return 'no-env'
  }
  const parsed = ownerEnv.safeParse(env)
  if (!parsed.success) {
    throw new Error(
      `First boot needs an owner: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    )
  }

  // The users audit hook records the creation.
  const req = await createLocalReq({ context: { [OWNER_SEED_CONTEXT]: true } }, payload)
  const owner = await payload.create({
    collection: 'users',
    data: {
      email: parsed.data.BUILDER_OWNER_EMAIL.trim().toLowerCase(),
      password: parsed.data.BUILDER_OWNER_PASSWORD,
    },
    overrideAccess: true,
    req,
  })
  payload.logger.info(`Created builder owner ${owner.email}; set up TOTP on first sign-in`)
  return 'seeded'
}
