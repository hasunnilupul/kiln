// Types, schema and module gating only. Signing lives in `@kiln/licence/sign` (builder) and
// verification in `@kiln/licence/verify` (POS) so neither pulls in the other.
export {
  LICENCE_ALGORITHM,
  LICENCE_PAYLOAD_VERSION,
  LICENCE_STATUSES,
  effectiveModules,
  licenceFileSchema,
  licencePayloadSchema,
  licenceStatusSchema,
  type LicenceFile,
  type LicencePayload,
  type LicenceStatus,
  type LicenceStatusValue,
} from './licence.js'
