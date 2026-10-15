import path from 'node:path'

import 'dotenv/config'

/**
 * End-to-end tests run against their own database (`<name>_e2e`), recreated on every run, so a
 * real first boot happens and development data is never touched.
 */
const base = new URL(process.env.DATABASE_URI || 'postgres://kiln:kiln@localhost:5432/kiln_pos')
export const e2eDatabaseName = `${base.pathname.slice(1)}_e2e`
export const adminDatabaseUri = Object.assign(new URL(base), { pathname: '/postgres' }).toString()
export const e2eDatabaseUri = Object.assign(new URL(base), {
  pathname: `/${e2eDatabaseName}`,
}).toString()

export const port = Number(process.env.E2E_PORT || 3100)
export const baseURL = `http://localhost:${port}`

export const seed = {
  configPath: path.resolve(
    import.meta.dirname,
    '../../../../packages/client-config/examples/acme-mart.client.config.json',
  ),
  adminEmail: 'owner@acmemart.example',
  initialPassword: 'e2e-initial-password',
  newPassword: 'e2e-owner-password-2',
  managerPin: '2468',
}

/** Environment for the server and test workers. */
export const e2eEnv = {
  DATABASE_URI: e2eDatabaseUri,
  PAYLOAD_SECRET: process.env.PAYLOAD_SECRET || 'e2e-only-secret-0123456789abcdef0123456789',
  CLIENT_CONFIG_PATH: seed.configPath,
  INITIAL_ADMIN_PASSWORD: seed.initialPassword,
  PUBLIC_URL: baseURL,
  PORT: String(port),
}
