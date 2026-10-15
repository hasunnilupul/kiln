import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clientConfigPath, loadSeedInputs } from '@/lib/seed'

const example = path.resolve(
  import.meta.dirname,
  '../../../../packages/client-config/examples/acme-mart.client.config.json',
)

let dir: string
let configPath: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kiln-seed-'))
  configPath = path.join(dir, 'client.config.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv
const password = 'a-long-initial-password'

describe('loadSeedInputs (FR-02, FR-03)', () => {
  it('reads the config and password, resolving assets next to the config', async () => {
    await writeFile(configPath, await readFile(example, 'utf8'))
    const inputs = await loadSeedInputs(
      env({ CLIENT_CONFIG_PATH: configPath, INITIAL_ADMIN_PASSWORD: password }),
    )
    expect(inputs?.config.client.slug).toBe('acme-mart')
    expect(inputs?.adminPassword).toBe(password)
    expect(inputs?.assetsDir).toBe(dir)
  })

  it('skips seeding without a config in development', async () => {
    await expect(
      loadSeedInputs(env({ CLIENT_CONFIG_PATH: configPath, NODE_ENV: 'development' })),
    ).resolves.toBeNull()
  })

  it('refuses to start a production server without a config', async () => {
    await expect(
      loadSeedInputs(env({ CLIENT_CONFIG_PATH: configPath, NODE_ENV: 'production' })),
    ).rejects.toThrow(/does not exist/)
  })

  it('rejects an invalid config', async () => {
    await writeFile(configPath, JSON.stringify({ schemaVersion: 2 }))
    await expect(
      loadSeedInputs(env({ CLIENT_CONFIG_PATH: configPath, INITIAL_ADMIN_PASSWORD: password })),
    ).rejects.toThrow(/Invalid client config/)
  })

  it.each([undefined, 'short'])(
    'requires a strong INITIAL_ADMIN_PASSWORD (%s)',
    async (initial) => {
      await writeFile(configPath, await readFile(example, 'utf8'))
      const values: Record<string, string> = { CLIENT_CONFIG_PATH: configPath }
      if (initial) values.INITIAL_ADMIN_PASSWORD = initial
      await expect(loadSeedInputs(env(values))).rejects.toThrow(/INITIAL_ADMIN_PASSWORD/)
    },
  )
})

describe('clientConfigPath', () => {
  it('defaults to client.config.json in the working directory', () => {
    expect(clientConfigPath(env({}))).toBe(path.resolve('client.config.json'))
  })
})
