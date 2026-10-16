/** True when serving a production build (not while `next build` compiles it). */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && env.NEXT_PHASE !== 'phase-production-build'
}

/** True while `next build` compiles the app; nothing should touch the database then. */
export function isBuildPhase(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_PHASE === 'phase-production-build'
}
