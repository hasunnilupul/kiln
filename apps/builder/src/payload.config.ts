import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { AuditLog } from './collections/AuditLog'
import { ClientConfigs } from './collections/ClientConfigs'
import { Clients } from './collections/Clients'
import { LoginAttempts } from './collections/LoginAttempts'
import { Users } from './collections/Users'
import { authEndpoints } from './endpoints/sign-in'
import { parseAllowlist } from './lib/client-ip'
import { isBuildPhase } from './lib/runtime'
import { seedOwner } from './lib/seed-owner'
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
      views: {
        // Password + TOTP sign-in (BR-01) in place of Payload's email/password form.
        login: { Component: '/components/SignIn#SignInView' },
      },
    },
  },
  endpoints: [...authEndpoints],
  // The builder has no GraphQL clients; turning it off leaves one API surface to secure.
  graphQL: { disable: true },
  // Runs after prodMigrations: refuses to start with an invalid IP allowlist (BR-03), then
  // creates the first owner from the environment (BR-01).
  onInit: async (payload) => {
    parseAllowlist(process.env.BUILDER_IP_ALLOWLIST)
    await seedOwner(payload)
  },
  collections: [Clients, ClientConfigs, Users, AuditLog, LoginAttempts],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
    // Development pushes schema changes directly; production runs these on startup, but never
    // during `next build`. Generate one with `pnpm --filter builder payload migrate:create`.
    prodMigrations: isBuildPhase() ? undefined : migrations,
  }),
})
