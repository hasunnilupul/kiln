/**
 * Starts the POS for end-to-end tests: recreates the e2e database, then runs `next dev` on the
 * e2e port. Playwright's `webServer` runs this and waits for the health endpoint.
 */
import { spawn } from 'node:child_process'

import pg from 'pg'

import { adminDatabaseUri, e2eDatabaseName, e2eEnv, port } from './env'

const client = new pg.Client({ connectionString: adminDatabaseUri })
await client.connect()
await client.query(`drop database if exists "${e2eDatabaseName}" with (force)`)
await client.query(`create database "${e2eDatabaseName}"`)
await client.end()

const server = spawn('pnpm', ['exec', 'next', 'dev', '-p', String(port)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...e2eEnv, NODE_OPTIONS: '--no-deprecation' },
})
server.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal))
