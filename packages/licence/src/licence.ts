import { MODULE_NAMES, type ModulesConfig } from '@kiln/client-config'
import { z } from 'zod'

export const LICENCE_PAYLOAD_VERSION = 1
export const LICENCE_ALGORITHM = 'Ed25519'

/** Lower-case DNS hostname or IPv4 address, without scheme or port. */
const hostname = z
  .string()
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
    'Use a lower-case hostname such as pos.example.com, without scheme or port',
  )

/** What a licence grants (BR-30). Signed by the builder; verified by the POS. */
export const licencePayloadSchema = z
  .strictObject({
    version: z.literal(LICENCE_PAYLOAD_VERSION),
    licenceId: z.string().min(1).max(64),
    /** Matches `client.id` in the client config. */
    clientId: z.string().min(1).max(64),
    /** Hostnames the POS may run under, compared with the host of `PUBLIC_URL`. */
    allowedHosts: z.array(hostname).min(1),
    modules: z.array(z.enum(MODULE_NAMES)),
    maxRegisters: z.int().min(1),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine((payload) => Date.parse(payload.expiresAt) > Date.parse(payload.issuedAt), {
    path: ['expiresAt'],
    message: 'Must be after issuedAt',
  })
  .refine((payload) => new Set(payload.modules).size === payload.modules.length, {
    path: ['modules'],
    message: 'Modules must not repeat',
  })

export type LicencePayload = z.output<typeof licencePayloadSchema>

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'Must be base64url')

/** Shape of `licence.json`. `payload` is base64url JSON so the signature covers exact bytes. */
export const licenceFileSchema = z.strictObject({
  alg: z.literal(LICENCE_ALGORITHM),
  payload: base64url,
  signature: base64url,
})

export type LicenceFile = z.output<typeof licenceFileSchema>

/** Modules a settings toggle may turn on: anything not in the licence stays off. */
export function effectiveModules(enabled: ModulesConfig, licence: LicencePayload): ModulesConfig {
  const licensed = new Set(licence.modules)
  return {
    inventory: enabled.inventory && licensed.has('inventory'),
    customers: enabled.customers && licensed.has('customers'),
    discounts: enabled.discounts && licensed.has('discounts'),
    multiOutlet: enabled.multiOutlet && licensed.has('multiOutlet'),
  }
}
