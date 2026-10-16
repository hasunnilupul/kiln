// Load .env files
import 'dotenv/config'

import { generateLicenceKeyPair } from '@kiln/licence/sign'

// Tests sign licences with a throwaway key unless the environment provides one.
process.env.LICENCE_SIGNING_KEY ||= generateLicenceKeyPair().privateKeyPem
