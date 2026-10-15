import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parseClientConfigJson, type ClientConfig } from '@kiln/client-config'
import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import { writeAudit } from '../hooks/audit'
import { isBuildPhase, isProductionRuntime } from './runtime'

export const MIN_ADMIN_PASSWORD_LENGTH = 12

export interface SeedInputs {
  config: ClientConfig
  adminPassword: string
  /** Folder that relative asset paths in the config (e.g. the logo) resolve against. */
  assetsDir: string
}

/** `CLIENT_CONFIG_PATH`, or `client.config.json` in the working directory as in a client build. */
export function clientConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.CLIENT_CONFIG_PATH?.trim() || 'client.config.json')
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/**
 * Reads and validates what first-boot seeding needs. Returns null when there is no config file
 * outside production, so development can run unseeded; throws for anything else that is missing
 * or invalid.
 */
export async function loadSeedInputs(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedInputs | null> {
  const configPath = clientConfigPath(env)
  if (!(await exists(configPath))) {
    if (isProductionRuntime(env)) {
      throw new Error(`First boot needs ${configPath}, but it does not exist`)
    }
    return null
  }
  const config = parseClientConfigJson(await readFile(configPath, 'utf8'))

  const adminPassword = env.INITIAL_ADMIN_PASSWORD ?? ''
  if (adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `First boot needs INITIAL_ADMIN_PASSWORD of at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
    )
  }
  return { config, adminPassword, assetsDir: path.dirname(configPath) }
}

/**
 * Seeds an empty database from the client config (FR-02) and creates the first admin (FR-03).
 * Runs inside the transaction on `req`; the caller commits or rolls back.
 */
export async function seedDatabase(
  payload: Payload,
  inputs: SeedInputs,
  req: PayloadRequest,
): Promise<void> {
  const { config, adminPassword, assetsDir } = inputs
  const write = { overrideAccess: true, req } as const

  const taxRateIds = new Map<string, number>()
  for (const rate of config.tax.rates) {
    const doc = await payload.create({
      collection: 'tax-rates',
      data: { code: rate.code, name: rate.name, ratePercent: rate.ratePercent },
      ...write,
    })
    taxRateIds.set(rate.code, doc.id)
  }

  for (const [index, method] of config.paymentMethods.entries()) {
    await payload.create({
      collection: 'payment-methods',
      data: { ...method, sortOrder: index },
      ...write,
    })
  }

  const outletIds: number[] = []
  for (const outlet of config.outlets) {
    const doc = await payload.create({
      collection: 'outlets',
      data: { code: outlet.code, name: outlet.name, address: outlet.address },
      ...write,
    })
    outletIds.push(doc.id)
    for (const register of outlet.registers) {
      await payload.create({
        collection: 'registers',
        data: { code: register.code, name: register.name, outlet: doc.id, nextSaleNumber: 1 },
        ...write,
      })
    }
  }

  let logoId: number | undefined
  if (config.branding.logo) {
    const logoPath = path.resolve(assetsDir, config.branding.logo)
    if (await exists(logoPath)) {
      // The upload goes to R2 or Vercel Blob before the row is written. If storage is not
      // reachable yet, trade can still start: the admin uploads the logo later.
      try {
        const logo = await payload.create({
          collection: 'media',
          data: { alt: `${config.client.displayName} logo` },
          filePath: logoPath,
          ...write,
        })
        logoId = logo.id
      } catch (error) {
        payload.logger.error(
          { err: error },
          'Could not upload the logo to media storage; seeding without a logo. Check STORAGE_DRIVER settings.',
        )
      }
    } else {
      payload.logger.warn(`Logo ${logoPath} not found; seeding without a logo`)
    }
  }

  await payload.updateGlobal({
    slug: 'branding',
    data: {
      logo: logoId,
      primaryColor: config.branding.primaryColor,
      accentColor: config.branding.accentColor,
      receiptHeader: config.branding.receiptHeader,
      receiptFooter: config.branding.receiptFooter,
    },
    ...write,
  })

  await payload.updateGlobal({
    slug: 'system-settings',
    data: {
      legalName: config.client.legalName,
      displayName: config.client.displayName,
      address: config.client.address,
      phone: config.client.phone,
      email: config.client.email,
      taxRegistrationNo: config.client.taxRegistrationNo,
      currency: config.locale.currency,
      locale: config.locale.locale,
      timezone: config.locale.timezone,
      dateFormat: config.locale.dateFormat,
      pricesIncludeTax: config.tax.pricesIncludeTax,
      defaultTaxRate: taxRateIds.get(config.tax.defaultRateCode),
      modules: config.modules,
      receipt: {
        paperWidthMm: String(config.receipt.paperWidthMm) as '58' | '80',
        showTaxBreakdown: config.receipt.showTaxBreakdown,
        showCashierName: config.receipt.showCashierName,
      },
      clientId: config.client.id,
      configSchemaVersion: config.schemaVersion,
      seededAt: new Date().toISOString(),
    },
    ...write,
  })

  await payload.create({
    collection: 'users',
    data: {
      email: config.admin.email,
      name: config.admin.name,
      password: adminPassword,
      role: 'admin',
      outlets: outletIds,
      // The password came from .env; the admin must replace it on first login (FR-03).
      mustChangePassword: true,
    },
    ...write,
  })

  await writeAudit(req, {
    action: 'seed',
    entity: 'system',
    data: { clientId: config.client.id, configSchemaVersion: config.schemaVersion },
  })
}

/** True when the database has never been seeded and holds no staff or outlets. */
export async function isDatabaseEmpty(payload: Payload, req?: PayloadRequest): Promise<boolean> {
  const settings = await payload.findGlobal({ slug: 'system-settings', overrideAccess: true, req })
  if (settings.seededAt) return false
  const [users, outlets] = await Promise.all([
    payload.count({ collection: 'users', overrideAccess: true, req }),
    payload.count({ collection: 'outlets', overrideAccess: true, req }),
  ])
  return users.totalDocs === 0 && outlets.totalDocs === 0
}

export type FirstBootResult = 'seeded' | 'already-seeded' | 'not-empty' | 'no-config'

/**
 * Seeds the database on first boot, all or nothing. Runs from `onInit`, after `prodMigrations`;
 * an error stops the server from serving (FR-01, FR-02).
 */
export async function seedOnFirstBoot(
  payload: Payload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FirstBootResult> {
  if (isBuildPhase(env)) return 'already-seeded'

  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    if (!(await isDatabaseEmpty(payload, req))) {
      const settings = await payload.findGlobal({
        slug: 'system-settings',
        overrideAccess: true,
        req,
      })
      await commitTransaction(req)
      if (settings.seededAt) return 'already-seeded'
      payload.logger.warn(
        'Database has data but was never seeded from a client config; not seeding',
      )
      return 'not-empty'
    }

    const inputs = await loadSeedInputs(env)
    if (!inputs) {
      await commitTransaction(req)
      payload.logger.warn(
        `No client config at ${clientConfigPath(env)}; skipping first-boot seeding (development only)`,
      )
      return 'no-config'
    }

    await seedDatabase(payload, inputs, req)
    await commitTransaction(req)
    payload.logger.info(
      `Seeded ${inputs.config.client.displayName} from ${clientConfigPath(env)}; ` +
        `admin ${inputs.config.admin.email} must change the initial password on first login`,
    )
    return 'seeded'
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}
