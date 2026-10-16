import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ModulesConfig } from '@kiln/client-config'
import { effectiveModules, licenceFileSchema, type LicencePayload } from '@kiln/licence'
import { readSignedLicence, verifyLicence, type LicenceFailureReason } from '@kiln/licence/verify'
import type { Payload } from 'payload'

import { callLicenceServer, decideCheckIn } from './licence-check-in'
import { LICENCE_PUBLIC_KEY_PEM, LICENCE_SERVER_URL } from './licence-public-key'
import { isBuildPhase, isProductionRuntime } from './runtime'

export const LICENCE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export type LicenceProblem =
  | LicenceFailureReason
  | 'missing'
  | 'no_public_key'
  | 'client_mismatch'
  | 'revoked'
  | 'check_in_overdue'

/** The last online check-in (BR-32), for the admin banner. */
export interface CheckInInfo {
  lastConfirmedAt: string
  /** Set while check-ins fail: when the grace period ends and the POS locks. */
  lockAt?: string
  failing?: string
}

export type LicenceState =
  | { status: 'valid'; licence: LicencePayload; checkedAt: string; checkIn?: CheckInInfo }
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

/** Registers allowed to open shifts, or null when unlimited (unlicensed development). */
export function licensedRegisterLimit(): number | null {
  const state = getLicenceState()
  if (state?.status === 'valid') return state.licence.maxRegisters
  if (state?.status === 'unlicensed-development' || (!state && !isProductionRuntime())) return null
  return 0
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

/**
 * Where the licence, its key and the licence server come from. Outside production the key and
 * server may come from the env; production uses only what the build embedded.
 */
export function licenceSources(env: NodeJS.ProcessEnv = process.env) {
  const production = isProductionRuntime(env)
  const envKey = env.LICENCE_PUBLIC_KEY?.replace(/\\n/g, '\n').trim()
  const envServer = env.LICENCE_SERVER_URL?.trim()
  const file = path.resolve(env.LICENCE_PATH?.trim() || 'licence.json')
  return {
    production,
    file,
    /** The builder's last signed check-in answer, kept next to the licence. */
    statusFile: path.join(path.dirname(file), 'licence-status.json'),
    publicKeyPem: production || !envKey ? LICENCE_PUBLIC_KEY_PEM : envKey,
    publicUrl: env.PUBLIC_URL?.trim() || (production ? '' : `http://localhost:${env.PORT || 3000}`),
    /** Empty means offline-only checks, e.g. a build made by hand with --dev-licence. */
    serverUrl: production || !envServer ? LICENCE_SERVER_URL : envServer,
  }
}

/** Replaces `file` in one step, so a crash never leaves half a licence. */
async function writeAtomic(file: string, text: string): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, text)
  await rename(temp, file)
}

/**
 * Online check-in (BR-32) for a licence signed by this POS's key: confirms it, installs a
 * renewal, records a revocation, or applies the grace period when the builder is unreachable.
 */
async function checkIn(
  payload: Payload,
  sources: ReturnType<typeof licenceSources>,
  inputs: LicenceInputs & { fileText: string },
  local: LicenceState,
  fetchImpl: typeof fetch,
): Promise<LicenceState> {
  let presented: ReturnType<typeof readSignedLicence>
  try {
    presented = readSignedLicence(inputs.fileText, inputs.publicKeyPem)
  } catch {
    return local
  }
  if (!presented.valid) return local
  if (inputs.clientId && presented.licence.clientId !== inputs.clientId) return local

  const now = inputs.now ?? new Date()
  let host = ''
  try {
    host = new URL(inputs.publicUrl).hostname
  } catch {
    // Reported by the licence check itself.
  }
  const verdict = decideCheckIn({
    licence: presented.licence,
    outcome: await callLicenceServer(sources.serverUrl, inputs.fileText, host, fetchImpl),
    storedStatusText: await readOptional(sources.statusFile),
    publicKeyPem: inputs.publicKeyPem,
    now,
  })
  const confirmedNow: CheckInInfo = { lastConfirmedAt: now.toISOString() }

  switch (verdict.kind) {
    case 'confirmed':
      await writeAtomic(sources.statusFile, verdict.statusText).catch((error: unknown) =>
        payload.logger.error({ err: error }, 'Could not store the licence check-in'),
      )
      return local.status === 'valid' ? { ...local, checkIn: confirmedNow } : local

    case 'revoked':
      await writeAtomic(sources.statusFile, verdict.statusText).catch((error: unknown) =>
        payload.logger.error({ err: error }, 'Could not store the licence revocation'),
      )
      return invalid('revoked', 'The provider revoked this licence', now)

    case 'renewed': {
      const fileText = `${JSON.stringify(licenceFileSchema.parse(verdict.licence), null, 2)}\n`
      const renewed = evaluateLicence({ ...inputs, fileText })
      if (renewed.status !== 'valid') {
        payload.logger.warn(
          `The provider sent a new licence that this POS cannot use: ${
            renewed.status === 'invalid' ? renewed.message : renewed.status
          }`,
        )
        return local
      }
      try {
        await writeAtomic(sources.file, fileText)
        await rm(sources.statusFile, { force: true })
      } catch (error) {
        payload.logger.error(
          { err: error },
          'Could not save the renewed licence; using it until restart',
        )
      }
      payload.logger.info(`Installed renewed licence ${renewed.licence.licenceId}`)
      return { ...renewed, checkIn: confirmedNow }
    }

    case 'grace':
      payload.logger.warn(
        `Licence check-in failed (${verdict.message}); the POS locks at ${verdict.lockAt}`,
      )
      return local.status === 'valid'
        ? {
            ...local,
            checkIn: {
              lastConfirmedAt: verdict.lastConfirmedAt,
              lockAt: verdict.lockAt,
              failing: verdict.message,
            },
          }
        : local

    case 'overdue':
      return local.status === 'valid' ? invalid('check_in_overdue', verdict.message, now) : local
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

/**
 * Reads `licence.json`, verifies it (FR-04), checks it in with the licence server when the
 * build names one (BR-32), and stores the result.
 */
export async function checkLicence(
  payload: Payload,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<LicenceState> {
  const sources = licenceSources(env)
  const settings = await payload.findGlobal({ slug: 'system-settings', overrideAccess: true })
  const inputs: LicenceInputs = {
    fileText: await readOptional(sources.file),
    publicKeyPem: sources.publicKeyPem,
    publicUrl: sources.publicUrl,
    production: sources.production,
    clientId: settings.clientId,
  }
  let state = evaluateLicence(inputs)
  // Also when the local licence has expired or was revoked: the answer may carry a renewal.
  if (sources.serverUrl && inputs.fileText !== null && state.status !== 'unlicensed-development') {
    state = await checkIn(
      payload,
      sources,
      { ...inputs, fileText: inputs.fileText },
      state,
      fetchImpl,
    )
  }
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
