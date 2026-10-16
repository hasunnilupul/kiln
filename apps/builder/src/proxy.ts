import type { NextRequest } from 'next/server'

import { clientIp, isAllowed, parseAllowlist } from './lib/client-ip'

type Ranges = ReturnType<typeof parseAllowlist>

/**
 * Routes callers reach from anywhere, each with its own credential: POS licence check-ins (the
 * signed licence, BR-32) and the build workflow on GitHub's runners (the build token, BR-21).
 */
const OPEN_ROUTES = [/^\/api\/licence-check$/, /^\/api\/builds\/\d+\/(job|callback)$/]

let cached: { value: string | undefined; ranges: Ranges } | undefined

/** The parsed allowlist, re-parsed only when the variable changes. */
function allowlist(): Ranges {
  const value = process.env.BUILDER_IP_ALLOWLIST
  if (!cached || cached.value !== value) cached = { value, ranges: parseAllowlist(value) }
  return cached.ranges
}

/**
 * Optional IP allowlist (BR-03): with `BUILDER_IP_ALLOWLIST` set, every page and API route except
 * the open routes above answers 403 to other addresses. An invalid allowlist fails closed; `onInit` also refuses to start with
 * one, so this only matters if the variable changes under a running process.
 */
export function proxy(request: NextRequest) {
  if (OPEN_ROUTES.some((route) => route.test(request.nextUrl.pathname))) return

  let ranges: Ranges
  try {
    ranges = allowlist()
  } catch {
    return new Response('Builder IP allowlist is misconfigured', { status: 503 })
  }
  if (ranges && !isAllowed(clientIp(request.headers), ranges)) {
    return new Response('Forbidden', { status: 403 })
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
