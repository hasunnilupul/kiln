import type { ClientConfig } from '@kiln/client-config'
import type { LicencePayload } from '@kiln/licence'

/** Node.js version a client build needs; `--env-file-if-exists` arrived in 22.9. */
export const NODE_REQUIREMENT = '22.9 or newer (22.x LTS)'

/** `.env.example` shipped in every zip; the client fills in `.env` (no secrets in the zip). */
export function envExample(config: ClientConfig, licence: LicencePayload): string {
  return `# ${config.client.displayName} POS - copy this file to .env and fill it in.

# PostgreSQL connection string for this POS's own database.
DATABASE_URI=postgres://USER:PASSWORD@localhost:5432/${config.client.slug.replace(/-/g, '_')}_pos

# At least 32 random characters. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
PAYLOAD_SECRET=

# Password for the first admin (${config.admin.email}), used once on first start and changed at
# first login. At least 12 characters.
INITIAL_ADMIN_PASSWORD=

# Address customers' tills use to reach this POS. Its host must be one of: ${licence.allowedHosts.join(', ')}
PUBLIC_URL=https://${licence.allowedHosts[0]}

# Port to listen on (default 3000), and the address to bind (default all interfaces).
PORT=3000
# BIND_ADDRESS=0.0.0.0

# Media storage for logos and product images: r2 or vercel-blob.
STORAGE_DRIVER=r2
# When STORAGE_DRIVER=r2 (Cloudflare R2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
# When STORAGE_DRIVER=vercel-blob
BLOB_READ_WRITE_TOKEN=
`
}

/** Linux and macOS start script. `.env` is read by Node itself, so values need no shell quoting. */
export const startSh = `#!/bin/sh
# Starts the POS. Run from anywhere; settings come from .env next to this file.
set -e
cd "$(dirname "$0")"
export NODE_ENV=production
export HOSTNAME="\${BIND_ADDRESS:-0.0.0.0}"
exec node --env-file-if-exists=.env server.js
`

/** Windows start script. */
export const startBat = `@echo off\r
rem Starts the POS. Settings come from .env next to this file.\r
cd /d "%~dp0"\r
set NODE_ENV=production\r
if "%BIND_ADDRESS%"=="" (set HOSTNAME=0.0.0.0) else (set HOSTNAME=%BIND_ADDRESS%)\r
node --env-file-if-exists=.env server.js\r
`

/** Install, run, upgrade and backup steps (NFR: backups documented in README.txt). */
export function readmeTxt(options: {
  config: ClientConfig
  licence: LicencePayload
  templateVersion: string
  configVersion: number
  zipName: string
  /** The builder's URL when this build checks its licence in online (BR-32). */
  licenceServer: string
}): string {
  const { config, licence, templateVersion, configVersion, zipName, licenceServer } = options
  const licenceSection = licenceServer
    ? `  licence.json binds this build to its hosts. Once a day the POS confirms it with
  ${licenceServer} over HTTPS, so the server needs internet access to that address.
  Renewals arrive the same way and replace licence.json automatically. If the check cannot
  reach the provider for 7 days, the POS stops serving until it can; the admin pages warn
  before that. GET /api/health shows the app, database and licence status.`
    : `  licence.json binds this build to its hosts. Renewed licences replace licence.json; the POS
  checks it on start and every 24 hours. GET /api/health shows the app, database and licence
  status.`
  const db = `${config.client.slug.replace(/-/g, '_')}_pos`
  return `${config.client.displayName} POS
${'='.repeat(config.client.displayName.length + 4)}

Build:    ${zipName}
Template: ${templateVersion}, configuration version ${configVersion}
Licence:  ${licence.licenceId}, valid until ${licence.expiresAt.slice(0, 10)}
          for ${licence.allowedHosts.join(', ')} and up to ${licence.maxRegisters} register(s)

REQUIREMENTS
  - Node.js ${NODE_REQUIREMENT}: https://nodejs.org
  - PostgreSQL 14 or newer, with an empty database for this POS
  - HTTPS in front of the POS for anything other than localhost (a reverse proxy such as
    Caddy or nginx)

FIRST INSTALL
  1. Unzip this file into its own folder, e.g. /opt/pos or C:\\pos.
  2. Create an empty database, e.g.:  createdb ${db}
  3. Copy .env.example to .env and fill it in (database, secret, first admin password,
     public URL and media storage).
  4. Start it:
       Linux/macOS:  ./start.sh
       Windows:      start.bat
     On first start the POS creates its tables and fills them from client.config.json.
  5. Open PUBLIC_URL in a browser. Sign in as ${config.admin.email} with
     INITIAL_ADMIN_PASSWORD and choose a new password. Managers use /admin; tills use /.

RUN AS A SERVICE
  Linux: a systemd unit with WorkingDirectory set to this folder and
         ExecStart=/path/to/this/folder/start.sh, Restart=always.
  Windows: a service wrapper such as NSSM pointing at start.bat.
  The POS restarts cleanly after a crash or reboot.

UPGRADE
  1. Stop the POS and back up the database (below).
  2. Replace everything in this folder with the new build EXCEPT .env and
     licence-status.json (if present).
  3. Start it again. Database changes are applied automatically on start.

LICENCE
${licenceSection}

BACKUPS
  The POS keeps all data in PostgreSQL. Back it up at least daily, and keep copies off this
  machine, e.g.:
    pg_dump --format=custom --file=${db}-$(date +%F).dump "$DATABASE_URI"
  Restore into an empty database with pg_restore. Backups are the responsibility of the
  party named in the licence agreement.

This software is licensed, not sold. Copying, reverse engineering and redistribution are not
permitted under the software licence agreement.
`
}

/** PWA manifest so tills can install the POS as an app (FR-81). */
export function webManifest(
  config: ClientConfig,
  logo: { path: string; type: string } | null,
): string {
  return `${JSON.stringify(
    {
      name: `${config.client.displayName} POS`,
      short_name: config.client.displayName,
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: config.branding.primaryColor,
      icons: logo ? [{ src: logo.path, sizes: 'any', type: logo.type, purpose: 'any' }] : [],
    },
    null,
    2,
  )}\n`
}
