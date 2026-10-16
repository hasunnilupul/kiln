/**
 * The GitHub API calls the builder makes for client builds (BR-20): list template versions (git
 * tags) and dispatch the `build-client.yml` workflow. The builder never builds anything itself.
 */

export interface GitHubSettings {
  token: string
  /** `owner/name` of the private repository holding the POS template. */
  repository: string
  workflow: string
  /** Branch the workflow file is dispatched on; the template version is checked out separately. */
  ref: string
}

/** Template versions are git tags such as `v1.2.0`; anything else is refused. */
export const TEMPLATE_VERSION_PATTERN = /^[\w.-]{1,64}$/

export class BuildsNotConfigured extends Error {
  constructor(missing: string[]) {
    super(`Client builds are not configured: set ${missing.join(', ')}`)
    this.name = 'BuildsNotConfigured'
  }
}

/** Settings from `GITHUB_TOKEN`, `GITHUB_REPOSITORY` and the optional workflow overrides. */
export function githubSettings(env: NodeJS.ProcessEnv = process.env): GitHubSettings {
  const missing = ['GITHUB_TOKEN', 'GITHUB_REPOSITORY'].filter((name) => !env[name]?.trim())
  if (missing.length > 0) throw new BuildsNotConfigured(missing)
  const repository = env.GITHUB_REPOSITORY!.trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error(`GITHUB_REPOSITORY must be owner/name, got "${repository}"`)
  }
  return {
    token: env.GITHUB_TOKEN!.trim(),
    repository,
    workflow: env.GITHUB_WORKFLOW_FILE?.trim() || 'build-client.yml',
    ref: env.GITHUB_WORKFLOW_REF?.trim() || 'main',
  }
}

async function github(
  settings: GitHubSettings,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const response = await fetchImpl(`https://api.github.com/repos/${settings.repository}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${settings.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `GitHub ${init.method ?? 'GET'} ${path} failed: ${response.status} ${detail.slice(0, 200)}`,
    )
  }
  return response
}

/** The repository's tags, newest first as GitHub returns them, limited to safe names. */
export async function listTemplateVersions(
  settings: GitHubSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const response = await github(settings, '/tags?per_page=100', { method: 'GET' }, fetchImpl)
  const tags = (await response.json()) as { name?: unknown }[]
  return tags
    .map((tag) => tag.name)
    .filter(
      (name): name is string => typeof name === 'string' && TEMPLATE_VERSION_PATTERN.test(name),
    )
}

/** Starts the build workflow for one build; GitHub answers 204 without a run id. */
export async function dispatchBuild(
  settings: GitHubSettings,
  inputs: { buildId: number; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await github(
    settings,
    `/actions/workflows/${encodeURIComponent(settings.workflow)}/dispatches`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: settings.ref,
        inputs: { build_id: String(inputs.buildId), token: inputs.token },
      }),
    },
    fetchImpl,
  )
}
