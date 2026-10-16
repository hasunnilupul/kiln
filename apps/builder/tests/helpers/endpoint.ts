import { createLocalReq, type Endpoint, type Payload } from 'payload'

import type { User } from '@/payload-types'

/** Calls a custom endpoint handler with a JSON body, as `user` or anonymously. */
export async function callEndpoint(
  payload: Payload,
  endpoint: Endpoint,
  options: {
    user?: User
    body?: unknown
    params?: Record<string, unknown>
    headers?: Record<string, string>
  } = {},
  // Response bodies are checked with toMatchObject; typing each one would add nothing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; headers: Headers; body: any }> {
  const user = options.user ? { ...options.user, collection: 'users' as const } : null
  const req = await createLocalReq({ user: user ?? undefined }, payload)
  req.user = user
  req.headers = new Headers(options.headers)
  req.data = (options.body ?? {}) as Record<string, unknown>
  req.routeParams = options.params ?? {}
  const response = await endpoint.handler(req)
  return { status: response.status, headers: response.headers, body: await response.json() }
}
