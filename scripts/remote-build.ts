/**
 * The builder's side of `.github/workflows/build-client.yml` (pipeline steps 1 and 9). Talks to
 * the builder with the short-lived build token the dispatch carried; never prints it.
 *
 *   tsx scripts/remote-build.ts start       fetch the job, write its files, report "building"
 *   tsx scripts/remote-build.ts upload-plan read the build summary, output the zip path and R2 key
 *   tsx scripts/remote-build.ts succeeded   report the uploaded zip
 *   tsx scripts/remote-build.ts failed      report a failure, pointing at the run's logs
 *
 * Environment: BUILDER_URL, BUILD_ID, BUILD_TOKEN, RUN_URL, GITHUB_OUTPUT; JOB_DIR (default "job").
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const env = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const jobDir = path.resolve(process.env.JOB_DIR?.trim() || 'job')
const jobFile = path.join(jobDir, 'job.json')
const summaryFile = path.join(jobDir, 'build-summary.json')

interface Job {
  buildId: number
  clientSlug: string
  templateVersion: string
  configVersion: number
  config: unknown
  licence: unknown
  publicKey: string
  licenceServer: string
  zipKeyPrefix: string
}

interface Summary {
  zip: string
  name: string
  size: number
  sha256: string
  templateVersion: string
  commit: string
  configVersion: number
  licenceId: string
}

/** Sets step outputs; values are checked so a newline cannot inject another output. */
function output(values: Record<string, string | number>) {
  const lines = Object.entries(values).map(([key, value]) => {
    const text = String(value)
    if (/[\r\n]/.test(text)) throw new Error(`Output ${key} contains a newline`)
    return `${key}=${text}`
  })
  appendFileSync(env('GITHUB_OUTPUT'), `${lines.join('\n')}\n`)
}

async function builder(method: 'GET' | 'POST', route: string, body?: unknown): Promise<unknown> {
  const response = await fetch(
    new URL(`/api/builds/${env('BUILD_ID')}/${route}`, env('BUILDER_URL')),
    {
      method,
      headers: {
        Authorization: `Bearer ${env('BUILD_TOKEN')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    },
  )
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!response.ok) {
    throw new Error(`Builder ${method} ${route}: ${response.status} ${json?.error?.message ?? ''}`)
  }
  return json
}

const command = process.argv[2]

if (command === 'start') {
  const job = (await builder('GET', 'job')) as Job
  mkdirSync(jobDir, { recursive: true })
  writeFileSync(jobFile, JSON.stringify(job))
  writeFileSync(path.join(jobDir, 'client.config.json'), `${JSON.stringify(job.config, null, 2)}\n`)
  writeFileSync(path.join(jobDir, 'licence.json'), `${JSON.stringify(job.licence, null, 2)}\n`)
  writeFileSync(path.join(jobDir, 'public.pem'), job.publicKey)
  output({
    template_version: job.templateVersion,
    config_version: job.configVersion,
    licence_server: job.licenceServer,
  })
  await builder('POST', 'callback', { status: 'building', runUrl: env('RUN_URL') })
  console.log(`Building ${job.clientSlug} ${job.templateVersion} c${job.configVersion}`)
} else if (command === 'upload-plan') {
  const job = JSON.parse(readFileSync(jobFile, 'utf8')) as Job
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8')) as Summary
  output({ zip_path: summary.zip, zip_key: `${job.zipKeyPrefix}${summary.name}` })
} else if (command === 'succeeded') {
  const job = JSON.parse(readFileSync(jobFile, 'utf8')) as Job
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8')) as Summary
  await builder('POST', 'callback', {
    status: 'succeeded',
    runUrl: env('RUN_URL'),
    zipKey: `${job.zipKeyPrefix}${summary.name}`,
    zipName: summary.name,
    size: summary.size,
    sha256: summary.sha256,
    commit: summary.commit,
    templateVersion: summary.templateVersion,
    configVersion: summary.configVersion,
    licenceId: summary.licenceId,
  })
  console.log(`Reported ${summary.name} (${summary.sha256})`)
} else if (command === 'failed') {
  await builder('POST', 'callback', {
    status: 'failed',
    runUrl: env('RUN_URL'),
    error: process.env.BUILD_ERROR?.trim() || 'The build workflow failed; see the workflow logs',
  })
} else {
  console.error('Usage: tsx scripts/remote-build.ts start | upload-plan | succeeded | failed')
  process.exit(2)
}
