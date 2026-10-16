'use client'

/** Header carrying the PIN-switched staff member (see `src/lib/pin.ts`). */
const ACTING_HEADER = 'x-kiln-acting-user'
const ACTING_KEY = 'kiln:acting'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface ActingUser {
  token: string
  user: { id: number; name: string; role: 'admin' | 'manager' | 'cashier' }
}

/** The colleague working the till after a PIN switch, kept for this browser tab only (FR-12). */
export function getActing(): ActingUser | null {
  try {
    const raw = sessionStorage.getItem(ACTING_KEY)
    return raw ? (JSON.parse(raw) as ActingUser) : null
  } catch {
    return null
  }
}

export function setActing(acting: ActingUser | null) {
  try {
    if (acting) sessionStorage.setItem(ACTING_KEY, JSON.stringify(acting))
    else sessionStorage.removeItem(ACTING_KEY)
  } catch {
    // Storage unavailable: the switch lasts until reload.
  }
}

/** JSON request to the POS API with the session cookie and acting user. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const acting = getActing()
  if (acting) headers[ACTING_HEADER] = acting.token

  const response = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    credentials: 'include',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && data?.error?.code === 'acting_user_expired') setActing(null)
    const error = data?.error ?? data?.errors?.[0] ?? {}
    throw new ApiError(response.status, error.code ?? 'error', error.message ?? 'Request failed')
  }
  return data as T
}
