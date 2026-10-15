import { PricingError } from '@kiln/pricing'
import {
  addDataAndFileToRequest,
  ValidationError,
  type Endpoint,
  type PayloadRequest,
} from 'payload'
import { z } from 'zod'

import { hasRole, outletIds, type Role } from '../../access/roles'
import { isLicenceUsable } from '../../lib/licence'
import type { User } from '../../payload-types'

/** An error with an HTTP status and a stable code the cashier screen can branch on. */
export class PosError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PosError'
    this.status = status
    this.code = code
  }
}

export const STAFF: Role[] = ['admin', 'manager', 'cashier']
export const MANAGERS: Role[] = ['admin', 'manager']

/** Positive or zero integer minor units. */
export const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const id = z.number().int().positive()

/**
 * The signed-in user if they hold one of `roles`. Custom endpoints are not authenticated by
 * Payload, so every handler calls this first (CLAUDE.md: Access control).
 */
export function requireUser(req: PayloadRequest, roles: Role[]): User & { collection: 'users' } {
  const user = req.user
  if (!user || user.collection !== 'users') {
    throw new PosError(401, 'unauthenticated', 'Sign in first')
  }
  if (!isLicenceUsable()) {
    throw new PosError(503, 'unlicensed', 'This POS is not licensed')
  }
  if (user.mustChangePassword) {
    throw new PosError(403, 'password_change_required', 'Change your password first')
  }
  if (!hasRole(user, ...roles)) {
    throw new PosError(403, 'forbidden', 'You are not allowed to do this')
  }
  return user
}

/** Throws unless the user works at `outlet` (FR-11). Admins work everywhere. */
export function assertOutletAccess(
  user: User & { collection: 'users' },
  outlet: number | { id: number },
) {
  const outletId = typeof outlet === 'object' ? outlet.id : outlet
  if (!hasRole(user, 'admin') && !outletIds(user).includes(outletId)) {
    throw new PosError(403, 'outlet_forbidden', 'This belongs to an outlet you do not work at')
  }
}

/** The numeric `:id` route parameter. */
export function routeId(req: PayloadRequest): number {
  const parsed = id.safeParse(Number(req.routeParams?.id))
  if (!parsed.success) throw new PosError(400, 'invalid_id', 'Invalid id')
  return parsed.data
}

/** Relationship value (id or populated document) as an id. */
export function relId(value: number | { id: number } | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return typeof value === 'object' ? value.id : value
}

async function readBody(req: PayloadRequest): Promise<unknown> {
  if (req.data === undefined) await addDataAndFileToRequest(req)
  return req.data ?? {}
}

interface PosEndpointOptions<Schema extends z.ZodType> {
  method: 'get' | 'post'
  path: string
  /** Validates the JSON body (CLAUDE.md: validate all external input with Zod). */
  body?: Schema
  status?: number
  handler: (req: PayloadRequest, body: z.output<Schema>) => Promise<unknown>
}

/** A `/api/pos/...` endpoint with JSON in and out and consistent error responses. */
export function posEndpoint<Schema extends z.ZodType = z.ZodUndefined>(
  options: PosEndpointOptions<Schema>,
): Endpoint {
  return {
    method: options.method,
    path: `/pos${options.path}`,
    handler: async (req) => {
      try {
        const body = options.body ? options.body.parse(await readBody(req)) : undefined
        const result = await options.handler(req, body as z.output<Schema>)
        return Response.json(result, { status: options.status ?? 200 })
      } catch (error) {
        return errorResponse(req, error)
      }
    },
  }
}

function errorResponse(req: PayloadRequest, error: unknown): Response {
  const reply = (status: number, code: string, message: string, details?: unknown) =>
    Response.json({ error: { code, message, details } }, { status })

  if (error instanceof PosError) return reply(error.status, error.code, error.message)
  if (error instanceof z.ZodError) {
    return reply(400, 'invalid_request', 'The request is invalid', z.flattenError(error))
  }
  if (error instanceof PricingError) return reply(422, error.code, error.message)
  if (error instanceof ValidationError) return reply(400, 'invalid_data', error.message, error.data)
  req.payload.logger.error({ err: error }, 'POS endpoint failed')
  return reply(500, 'internal_error', 'Something went wrong')
}
