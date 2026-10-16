// Load .env files
import 'dotenv/config'

import { generateLicenceKeyPair } from '@kiln/licence/sign'

// CI runs the POS and builder tests side by side against one Postgres server; each app needs a
// database of its own, or pushing one schema trips over the other's tables and enums.
if (process.env.BUILDER_TEST_DATABASE_URI) {
  process.env.DATABASE_URI = process.env.BUILDER_TEST_DATABASE_URI
}

// Tests sign licences with a throwaway key unless the environment provides one.
process.env.LICENCE_SIGNING_KEY ||= generateLicenceKeyPair().privateKeyPem
