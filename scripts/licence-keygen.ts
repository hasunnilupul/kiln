/**
 * Generates the builder's Ed25519 licence signing key (BR-31) and prints it once, as a
 * one-line value for LICENCE_SIGNING_KEY. Nothing is written to disk. Store it in the builder's
 * secret store and keep a backup: losing it means existing builds cannot be renewed, and
 * replacing it means rebuilding every client.
 *
 *   pnpm licence:keygen
 */
import { generateLicenceKeyPair } from '@kiln/licence/sign'

const keys = generateLicenceKeyPair()
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n')

console.log('Builder licence signing key (secret; store it, never commit it):\n')
console.log(`LICENCE_SIGNING_KEY="${oneLine(keys.privateKeyPem)}"\n`)
console.log('Public key, for reference (the builder derives it from the signing key):\n')
console.log(keys.publicKeyPem.trim())
