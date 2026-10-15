import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { AuditLog } from './collections/AuditLog'
import { CashMovements } from './collections/CashMovements'
import { Categories } from './collections/Categories'
import { Customers } from './collections/Customers'
import { Media } from './collections/Media'
import { Outlets } from './collections/Outlets'
import { PaymentMethods } from './collections/PaymentMethods'
import { ProductVariants } from './collections/ProductVariants'
import { Products } from './collections/Products'
import { Refunds } from './collections/Refunds'
import { Registers } from './collections/Registers'
import { Sales } from './collections/Sales'
import { Shifts } from './collections/Shifts'
import { StockLevels } from './collections/StockLevels'
import { StockMovements } from './collections/StockMovements'
import { TaxRates } from './collections/TaxRates'
import { Users } from './collections/Users'
import { Branding } from './globals/Branding'
import { SystemSettings } from './globals/SystemSettings'
import { health } from './endpoints/health'
import { startLicenceChecks } from './lib/licence'
import { seedOnFirstBoot } from './lib/seed'
import { resolveStorage, storagePlugins } from './lib/storage'
import { migrations } from './migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      header: [
        '/components/LicenceNotice#LicenceBanner',
        '/components/PasswordChangeNotice#PasswordChangeBanner',
      ],
      beforeDashboard: ['/components/PasswordChangeNotice#RedirectToAccount'],
    },
  },
  endpoints: [health],
  // Runs after prodMigrations: seeds an empty database from client.config.json (FR-02, FR-03),
  // then verifies licence.json now and every 24 hours (FR-04).
  onInit: async (payload) => {
    await seedOnFirstBoot(payload)
    await startLicenceChecks(payload)
  },
  collections: [
    Sales,
    Refunds,
    Shifts,
    CashMovements,
    Customers,
    Products,
    ProductVariants,
    Categories,
    Media,
    StockLevels,
    StockMovements,
    Users,
    Outlets,
    Registers,
    TaxRates,
    PaymentMethods,
    AuditLog,
  ],
  globals: [SystemSettings, Branding],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
    // Development pushes schema changes directly; production runs these on startup before
    // serving requests (FR-01). Generate one with `pnpm --filter pos payload migrate:create`.
    prodMigrations: migrations,
  }),
  plugins: [...storagePlugins(resolveStorage(process.env))],
})
