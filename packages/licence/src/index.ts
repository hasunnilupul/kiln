// Types, schema and module gating only. Signing lives in `@kiln/licence/sign` (builder) and
// verification in `@kiln/licence/verify` (POS) so neither pulls in the other.
export {
  LICENCE_ALGORITHM,
  LICENCE_PAYLOAD_VERSION,
  effectiveModules,
  licenceFileSchema,
  licencePayloadSchema,
  type LicenceFile,
  type LicencePayload,
} from './licence.js'
