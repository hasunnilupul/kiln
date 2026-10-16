import { addDataAndFileToRequest, type Endpoint, type PayloadRequest } from 'payload'
import { z } from 'zod'

import type { User } from '../payload-types'

/** An error with an HTTP status and a stable code the builder UI can branch on. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly headers?: Record<string, string>

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = options.details
    this.headers = options.headers
  }
}

export type OwnerUser = User & { collection: 'users' }

/**
 * The signed-in owner. Custom endpoints are not access-controlled by Payload, so every handler
 * that is not public calls this first (CLAUDE.md: Access control).
 */
export function requireOwner(req: PayloadRequest): OwnerUser {
  const user = req.user
  if (!user || user.collection !== 'users') {
    throw new ApiError(401, 'unauthenticated', 'Sign in first')
  }
  return user
}

async function readBody(req: PayloadRequest): Promise<unknown> {
  if (req.data === undefined) await addDataAndFileToRequest(req)
  return req.data ?? {}
}

interface JsonEndpointOptions<Schema extends z.ZodType> {
  method: 'get' | 'post'
  path: string
  /** Validates the JSON body (CLAUDE.md: validate all external input with Zod). */
  body?: Schema
  status?: number
  handler: (req: PayloadRequest, body: z.output<Schema>) => Promise<unknown>
}

/** A `/api/...` endpoint with JSON in and out and consistent error responses. */
export function jsonEndpoint<Schema extends z.ZodType = z.ZodUndefined>(
  options: JsonEndpointOptions<Schema>,
): Endpoint {
  return {
    method: options.method,
    path: options.path,
    handler: async (req) => {
      try {
        const body = options.body ? options.body.parse(await readBody(req)) : undefined
        const result = await options.handler(req, body as z.output<Schema>)
        if (result instanceof Response) return result
        return Response.json(result, { status: options.status ?? 200 })
      } catch (error) {
        return errorResponse(req, error)
      }
    },
  }
}

function errorResponse(req: PayloadRequest, error: unknown): Response {
  const reply = (
    status: number,
    code: string,
    message: string,
    details?: unknown,
    headers?: Record<string, string>,
  ) => Response.json({ error: { code, message, details } }, { status, headers })

  if (error instanceof ApiError) {
    return reply(error.status, error.code, error.message, error.details, error.headers)
  }
  if (error instanceof z.ZodError) {
    return reply(400, 'invalid_request', 'The request is invalid', z.flattenError(error))
  }
  req.payload.logger.error({ err: error }, 'Builder endpoint failed')
  return reply(500, 'internal_error', 'Something went wrong')
}
