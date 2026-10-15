import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ModulesConfig } from '@kiln/client-config'
import { effectiveModules, type LicencePayload } from '@kiln/licence'
import { verifyLicence, type LicenceFailureReason } from '@kiln/licence/verify'
import type { Payload } from 'payload'

import { LICENCE_PUBLIC_KEY_PEM } from './licence-public-key'
import { isBuildPhase, isProductionRuntime } from './runtime'

export const LICENCE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export type LicenceProblem = LicenceFailureReason | 'missing' | 'no_public_key' | 'client_mismatch'

export type LicenceState =
  | { status: 'valid'; licence: LicencePayload; checkedAt: string }
  | { status: 'invalid'; reason: LicenceProblem; message: string; checkedAt: string }
  /** Development without `licence.json`: everything the settings enable is available. */
  | { status: 'unlicensed-development'; checkedAt: string }

/**
 * Process-wide, because Next.js may load this module once per route bundle while Payload is a
 * single instance.
 */
const store = globalThis as typeof globalThis & {
  __kilnLicenceState?: LicenceState
  __kilnLicenceTimer?: ReturnType<typeof setInterval>
}

export function getLicenceState(): LicenceState | undefined {
  return store.__kilnLicenceState
}

/** Replaces the current state. Exported for tests. */
export function setLicenceState(state: LicenceState | undefined): void {
  store.__kilnLicenceState = state
}

/**
 * Whether the POS may serve requests (FR-04). Before the first check this is true only outside
 * production, so tooling such as type generation never depends on a licence.
 */
export function isLicenceUsable(env: NodeJS.ProcessEnv = process.env): boolean {
  const state = getLicenceState()
  if (!state) return !isProductionRuntime(env)
  return state.status !== 'invalid'
}

/** Modules on in settings and granted by the licence; unlicensed modules stay off. */
export function licensedModules(enabled: ModulesConfig): ModulesConfig {
  const state = getLicenceState()
  if (state?.status === 'valid') return effectiveModules(enabled, state.licence)
  if (state?.status === 'unlicensed-development' || (!state && !isProductionRuntime()))
    return enabled
  return { inventory: false, customers: false, discounts: false, multiOutlet: false }
}

export interface LicenceInputs {
  /** Text of `licence.json`, or null when there is none. */
  fileText: string | null
  publicKeyPem: string
  publicUrl: string
  production: boolean
  /** Client ID seeded from the config; the licence must be issued to this client. */
  clientId?: string | null
  now?: Date
}

const invalid = (reason: LicenceProblem, message: string, now: Date): LicenceState => ({
  status: 'invalid',
  reason,
  message,
  checkedAt: now.toISOString(),
})

/** Decides the licence state from its inputs. Pure apart from the signature check. */
export function evaluateLicence(inputs: LicenceInputs): LicenceState {
  const now = inputs.now ?? new Date()
  if (inputs.fileText === null) {
    return inputs.production
      ? invalid('missing', 'licence.json was not found', now)
      : { status: 'unlicensed-development', checkedAt: now.toISOString() }
  }
  if (!inputs.publicKeyPem.trim()) {
    return invalid('no_public_key', 'This build has no licence public key', now)
  }

  let result: ReturnType<typeof verifyLicence>
  try {
    result = verifyLicence(inputs.fileText, {
      publicKeyPem: inputs.publicKeyPem,
      publicUrl: inputs.publicUrl,
      now,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return invalid('no_public_key', `The embedded licence public key is unusable: ${reason}`, now)
  }
  if (!result.valid) {
    return invalid(result.reason, result.message, now)
  }
  if (inputs.clientId && result.licence.clientId !== inputs.clientId) {
    return invalid('client_mismatch', `Licence is for client "${result.licence.clientId}"`, now)
  }
  return { status: 'valid', licence: result.licence, checkedAt: now.toISOString() }
}

/** Where the licence and its key come from. Outside production a key may come from the env. */
export function licenceSources(env: NodeJS.ProcessEnv = process.env) {
  const production = isProductionRuntime(env)
  const envKey = env.LICENCE_PUBLIC_KEY?.replace(/\\n/g, '\n').trim()
  return {
    production,
    file: path.resolve(env.LICENCE_PATH?.trim() || 'licence.json'),
    publicKeyPem: production || !envKey ? LICENCE_PUBLIC_KEY_PEM : envKey,
    publicUrl: env.PUBLIC_URL?.trim() || (production ? '' : `http://localhost:${env.PORT || 3000}`),
  }
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Reads `licence.json`, verifies it and stores the result (FR-04). */
export async function checkLicence(
  payload: Payload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LicenceState> {
  const sources = licenceSources(env)
  const settings = await payload.findGlobal({ slug: 'system-settings', overrideAccess: true })
  const state = evaluateLicence({
    fileText: await readOptional(sources.file),
    publicKeyPem: sources.publicKeyPem,
    publicUrl: sources.publicUrl,
    production: sources.production,
    clientId: settings.clientId,
  })
  setLicenceState(state)

  if (state.status === 'valid') {
    payload.logger.info(
      `Licence ${state.licence.licenceId} valid until ${state.licence.expiresAt} ` +
        `(modules: ${state.licence.modules.join(', ') || 'none'}; max registers ${state.licence.maxRegisters})`,
    )
  } else if (state.status === 'invalid') {
    payload.logger.error(
      `Licence invalid (${state.reason}): ${state.message}. The POS will not serve requests.`,
    )
  } else {
    payload.logger.warn(`No licence at ${sources.file}; running unlicensed (development only)`)
  }
  return state
}

/** Checks the licence now and then every 24 hours (FR-04); a renewed file is picked up then. */
export async function startLicenceChecks(payload: Payload): Promise<void> {
  if (isBuildPhase()) return
  await checkLicence(payload)
  if (!store.__kilnLicenceTimer) {
    store.__kilnLicenceTimer = setInterval(() => {
      checkLicence(payload).catch((error: unknown) => {
        payload.logger.error({ err: error }, 'Licence check failed')
        setLicenceState({
          status: 'invalid',
          reason: 'missing',
          message: 'The licence could not be checked',
          checkedAt: new Date().toISOString(),
        })
      })
    }, LICENCE_CHECK_INTERVAL_MS)
    store.__kilnLicenceTimer.unref()
  }
}
