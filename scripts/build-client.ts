/**
 * Config in, zip out (M4): builds a client's POS from a committed template version.
 *
 *   pnpm build:client --config <client.config.json> --licence <licence.json> --public-key <public.pem>
 *   pnpm build:client --config <client.config.json> --dev-licence        # local testing only
 *
 * Steps: validate the config and licence → check out the template at --ref into a temporary git
 * worktree → install with a flat node_modules → inject the licence public key and branding
 * assets → `next build` (standalone) → assemble a portable folder (no symlinks, TypeScript,
 * tests, source maps or native modules) → obfuscate the server bundle → write client.config.json,
 * licence.json, .env.example, start scripts and README.txt → zip → SHA-256.
 *
 * The working copy is never modified. Runs the same on a developer machine and in GitHub Actions,
 * which the builder triggers (M5). Prints a JSON summary on the last line of stdout.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'

import { MODULE_NAMES, parseClientConfigJson, type ClientConfig } from '@kiln/client-config'
import { licenceFileSchema, type LicencePayload } from '@kiln/licence'
import { generateLicenceKeyPair, serializeLicence, signLicence } from '@kiln/licence/sign'
import { verifyLicence } from '@kiln/licence/verify'
import { ZipArchive } from 'archiver'
import JavaScriptObfuscator from 'javascript-obfuscator'

import { envExample, readmeTxt, startBat, startSh, webManifest } from './lib/package-files'

const repoRoot = path.resolve(import.meta.dirname, '..')

const { values: args } = parseArgs({
  options: {
    config: { type: 'string' },
    licence: { type: 'string' },
    'public-key': { type: 'string' },
    'dev-licence': { type: 'boolean', default: false },
    ref: { type: 'string', default: 'HEAD' },
    'template-version': { type: 'string' },
    'config-version': { type: 'string', default: '1' },
    out: { type: 'string', default: path.join(repoRoot, 'dist-clients') },
    'keep-workdir': { type: 'boolean', default: false },
  },
})

const step = (message: string) => console.error(`\n▶ ${message}`)
const fail = (message: string): never => {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function run(command: string, commandArgs: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0)
    fail(`${command} ${commandArgs.join(' ')} failed (exit ${result.status})`)
}

function output(command: string, commandArgs: string[], cwd: string): string {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8' })
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/** Every file under `dir`, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const LOGO_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

// 1. Validate the config (BR-12) and its assets.
step('Validating the client config')
if (!args.config) fail('Pass --config <path to client.config.json>')
const configPath = path.resolve(args.config!)
const config: ClientConfig = parseClientConfigJson(readFileSync(configPath, 'utf8'))
const logoSource = config.branding.logo
  ? path.resolve(path.dirname(configPath), config.branding.logo)
  : null
if (logoSource && !existsSync(logoSource)) fail(`Logo ${logoSource} does not exist`)
const configVersion = Number(args['config-version'])
if (!Number.isInteger(configVersion) || configVersion < 1)
  fail('--config-version must be a positive integer')
console.error(
  `  ${config.client.displayName} (${config.client.id}), config version ${configVersion}`,
)

// 2. The signed licence and the public key the POS will embed (BR-30, BR-31).
step('Checking the licence')
let licenceText: string
let publicKeyPem: string
if (args['dev-licence']) {
  if (args.licence || args['public-key'])
    fail('Use either --dev-licence or --licence with --public-key')
  // A throwaway key: this build only works on this machine, for local testing.
  const keys = generateLicenceKeyPair()
  const now = new Date()
  licenceText = serializeLicence(
    signLicence(
      {
        version: 1,
        licenceId: `dev_${now.getTime().toString(36)}`,
        clientId: config.client.id,
        allowedHosts: ['localhost', '127.0.0.1'],
        modules: [...MODULE_NAMES],
        maxRegisters: config.outlets.reduce((sum, o) => sum + o.registers.length, 0),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      keys.privateKeyPem,
    ),
  )
  publicKeyPem = keys.publicKeyPem
  console.error('  Development licence for localhost, valid 30 days (do not ship this build)')
} else {
  if (!args.licence || !args['public-key'])
    fail('Pass --licence and --public-key, or --dev-licence')
  licenceText = readFileSync(path.resolve(args.licence!), 'utf8')
  publicKeyPem = readFileSync(path.resolve(args['public-key']!), 'utf8')
}
const licenceFile = licenceFileSchema.parse(JSON.parse(licenceText))
const payload = JSON.parse(
  Buffer.from(licenceFile.payload, 'base64url').toString('utf8'),
) as LicencePayload
const check = verifyLicence(licenceFile, {
  publicKeyPem,
  publicUrl: `https://${payload.allowedHosts?.[0] ?? 'invalid'}`,
})
if (!check.valid) fail(`Licence rejected: ${check.message}`)
const licence = check.valid ? check.licence : payload
if (licence.clientId !== config.client.id) {
  fail(`Licence is for client "${licence.clientId}", config is "${config.client.id}"`)
}
console.error(
  `  ${licence.licenceId}, hosts ${licence.allowedHosts.join(', ')}, until ${licence.expiresAt}`,
)

// 3. Template version: a git tag in production builds (BR-20, BR-22).
const commit = output('git', ['rev-parse', '--verify', `${args.ref}^{commit}`], repoRoot)
const templateVersion =
  args['template-version'] ?? output('git', ['describe', '--tags', '--always', commit], repoRoot)
if (!/^[\w.-]+$/.test(templateVersion))
  fail(`Template version "${templateVersion}" is not file-name safe`)
const zipName = `${config.client.slug}-pos-${templateVersion}-c${configVersion}.zip`

const workdir = mkdtempSync(path.join(tmpdir(), 'kiln-build-'))
const source = path.join(workdir, 'source')
const pkg = path.join(workdir, 'package')
let worktreeAdded = false

try {
  step(`Checking out ${templateVersion} (${commit.slice(0, 12)})`)
  run('git', ['worktree', 'add', '--detach', source, commit], repoRoot)
  worktreeAdded = true

  // A flat node_modules, so the standalone output has no pnpm symlinks to carry in a zip.
  step('Installing dependencies')
  run('pnpm', ['install', '--frozen-lockfile', '--config.node-linker=hoisted'], source)

  // 4. Inject the public key and branding (step 4 of the pipeline).
  step('Injecting the licence key and branding')
  const app = path.join(source, 'apps/pos')
  writeFileSync(
    path.join(app, 'src/lib/licence-public-key.ts'),
    `/** The builder's Ed25519 public key, written by scripts/build-client.ts (BR-31). */\nexport const LICENCE_PUBLIC_KEY_PEM = ${JSON.stringify(publicKeyPem.trim())}\n`,
  )
  let logo: { path: string; type: string } | null = null
  if (logoSource) {
    const ext = path.extname(logoSource).toLowerCase()
    mkdirSync(path.join(app, 'public/branding'), { recursive: true })
    copyFileSync(logoSource, path.join(app, `public/branding/logo${ext}`))
    logo = { path: `/branding/logo${ext}`, type: LOGO_TYPES[ext] ?? 'image/png' }
  }
  writeFileSync(path.join(app, 'public/manifest.webmanifest'), webManifest(config, logo))

  // 5. Standalone build. No database is touched and no source maps are produced.
  step('Building')
  run('pnpm', ['turbo', 'run', 'build', '--filter=pos'], source, {
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    TURBO_TELEMETRY_DISABLED: '1',
    PAYLOAD_SECRET: 'build-time-placeholder-not-used-at-runtime',
  })

  // 6. A portable folder: server.js at the top, every symlink replaced by a real copy.
  step('Assembling the package')
  const standalone = path.join(app, '.next/standalone')
  cpSync(path.join(standalone, 'apps/pos'), pkg, { recursive: true, dereference: true })
  cpSync(path.join(standalone, 'node_modules'), path.join(pkg, 'node_modules'), {
    recursive: true,
    dereference: true,
  })
  cpSync(path.join(app, '.next/static'), path.join(pkg, '.next/static'), { recursive: true })
  cpSync(path.join(app, 'public'), path.join(pkg, 'public'), { recursive: true })

  // No native modules (one zip for every OS), no source, tests or maps.
  // Development files the tracer picks up (sources, styles, tool configs) are compiled into the
  // bundle already; ship none of them.
  for (const dir of [
    'node_modules/sharp',
    'node_modules/@img',
    '.next/cache',
    'src',
    'tests',
    'tsconfig.json',
    'eslint.config.mjs',
    'components.json',
    'postcss.config.mjs',
    'next-env.d.ts',
  ]) {
    rmSync(path.join(pkg, dir), { recursive: true, force: true })
  }
  // server.js is an ES module; nothing else from the app's package.json is needed at runtime.
  writeFileSync(
    path.join(pkg, 'package.json'),
    `${JSON.stringify({ name: `${config.client.slug}-pos`, private: true, type: 'module' }, null, 2)}\n`,
  )
  for (const file of walk(pkg)) {
    const name = path.basename(file)
    const isSource = /\.(tsx?|mts|cts)$/.test(name) && !/\.d\.[mc]?ts$/.test(name)
    if (isSource || name.endsWith('.map') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) rmSync(file)
    else if (name.endsWith('.node'))
      fail(`Native module in the package: ${path.relative(pkg, file)}`)
  }
  // Workspace packages are usually bundled into the server chunks; if any were traced as
  // dependencies, ship only their compiled dist.
  const kilnModules = path.join(pkg, 'node_modules/@kiln')
  if (existsSync(kilnModules)) {
    for (const kiln of readdirSync(kilnModules)) {
      rmSync(path.join(kilnModules, kiln, 'src'), { recursive: true, force: true })
    }
  }

  // 7. Obfuscate the compiled server code. Client bundles stay minified only.
  step('Obfuscating the server bundle')
  const serverFiles = walk(path.join(pkg, '.next/server')).filter((f) => /\.[cm]?js$/.test(f))
  let obfuscated = 0
  for (const file of serverFiles) {
    const code = readFileSync(file, 'utf8')
    // Our code is in small chunks; very large chunks are bundled third-party libraries.
    if (code.length > 1_500_000) continue
    writeFileSync(
      file,
      JavaScriptObfuscator.obfuscate(code, {
        target: 'node',
        compact: true,
        simplify: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        stringArray: true,
        stringArrayThreshold: 0.5,
        stringArrayEncoding: [],
        splitStrings: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        debugProtection: false,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
        sourceMap: false,
        ignoreImports: true,
      }).getObfuscatedCode(),
    )
    obfuscated += 1
  }
  console.error(`  ${obfuscated} of ${serverFiles.length} server files obfuscated`)

  // 8. Client files: config (logo now inside public/), licence, env template, scripts, readme.
  step('Writing client files')
  const packagedConfig = {
    ...JSON.parse(readFileSync(configPath, 'utf8')),
    branding: {
      ...JSON.parse(readFileSync(configPath, 'utf8')).branding,
      ...(logo ? { logo: `public${logo.path}` } : {}),
    },
  }
  parseClientConfigJson(JSON.stringify(packagedConfig))
  writeFileSync(
    path.join(pkg, 'client.config.json'),
    `${JSON.stringify(packagedConfig, null, 2)}\n`,
  )
  writeFileSync(path.join(pkg, 'licence.json'), licenceText)
  writeFileSync(path.join(pkg, '.env.example'), envExample(config, licence))
  writeFileSync(path.join(pkg, 'start.sh'), startSh)
  writeFileSync(path.join(pkg, 'start.bat'), startBat)
  writeFileSync(
    path.join(pkg, 'README.txt'),
    readmeTxt({ config, licence, templateVersion, configVersion, zipName }).replace(/\n/g, '\r\n'),
  )

  // 9. Zip and checksum (BR-22).
  step(`Zipping ${zipName}`)
  const outDir = path.resolve(args.out!)
  mkdirSync(outDir, { recursive: true })
  const zipPath = path.join(outDir, zipName)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const written = pipeline(archive, createWriteStream(zipPath))
  for (const file of walk(pkg)) {
    const name = path.relative(pkg, file).split(path.sep).join('/')
    archive.file(file, { name, mode: name === 'start.sh' ? 0o755 : 0o644, date: new Date(0) })
  }
  await archive.finalize()
  await written

  const hash = createHash('sha256')
  await pipeline(createReadStream(zipPath), hash)
  const sha256 = hash.digest('hex')
  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${zipName}\n`)

  const summary = {
    zip: zipPath,
    name: zipName,
    size: statSync(zipPath).size,
    sha256,
    templateVersion,
    commit,
    configVersion,
    clientId: config.client.id,
    licenceId: licence.licenceId,
  }
  console.error(
    `\n✔ ${zipName} (${(summary.size / 1024 / 1024).toFixed(1)} MB)\n  sha256 ${sha256}`,
  )
  console.log(JSON.stringify(summary))
} finally {
  if (args['keep-workdir']) {
    console.error(`  Work directory kept at ${workdir}`)
  } else {
    if (worktreeAdded) run('git', ['worktree', 'remove', '--force', source], repoRoot)
    rmSync(workdir, { recursive: true, force: true })
  }
}
