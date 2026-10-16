/**
 * Development only: issues a throwaway licence so the POS licence check (FR-04) can be exercised
 * locally before the builder exists. Generates a fresh key pair on every run and never writes the
 * private key. Real licences are signed only by the builder (BR-31).
 *
 *   pnpm licence:dev [--host localhost] [--days 365]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { MODULE_NAMES, parseClientConfigJson } from '@kiln/client-config'
import { generateLicenceKeyPair, serializeLicence, signLicence } from '@kiln/licence/sign'

const root = path.resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    host: { type: 'string', default: 'localhost' },
    days: { type: 'string', default: '365' },
  },
})

const configPath = path.join(root, 'apps/pos/client.config.json')
const config = await readFile(configPath, 'utf8')
  .then(parseClientConfigJson)
  .catch(() => null)

const issuedAt = new Date()
const expiresAt = new Date(issuedAt.getTime() + Number(values.days) * 24 * 60 * 60 * 1000)
const keys = generateLicenceKeyPair()
const licence = signLicence(
  {
    version: 1,
    licenceId: `dev_${issuedAt.getTime().toString(36)}`,
    clientId: config?.client.id ?? 'cl_dev',
    allowedHosts: [values.host],
    modules: [...MODULE_NAMES],
    maxRegisters: config
      ? config.outlets.reduce((sum, outlet) => sum + outlet.registers.length, 0)
      : 1,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  },
  keys.privateKeyPem,
)

const outDir = path.join(root, '.licence-dev')
await mkdir(outDir, { recursive: true })
const licencePath = path.join(outDir, 'licence.json')
await writeFile(licencePath, serializeLicence(licence))

const escapedKey = keys.publicKeyPem.trim().replace(/\n/g, '\\n')
console.log(`Wrote ${licencePath} for host "${values.host}" until ${expiresAt.toISOString()}.`)
console.log('Add to apps/pos/.env (development only; production uses the embedded key):\n')
console.log(`LICENCE_PATH=${licencePath.replace(/\\/g, '/')}`)
console.log(`LICENCE_PUBLIC_KEY="${escapedKey}"`)
