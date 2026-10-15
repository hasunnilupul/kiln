import { z } from 'zod'

import { clientConfigSchema, type ClientConfig } from './schema.js'

/** Thrown when a client config cannot be parsed or fails validation. */
export class ClientConfigError extends Error {
  readonly issues: readonly z.core.$ZodIssue[]

  constructor(message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(message)
    this.name = 'ClientConfigError'
    this.issues = issues
  }
}

export type ClientConfigResult =
  { success: true; config: ClientConfig } | { success: false; error: ClientConfigError }

/** Validates an already-parsed value against the client config schema. */
export function safeParseClientConfig(input: unknown): ClientConfigResult {
  const result = clientConfigSchema.safeParse(input)
  if (result.success) {
    return { success: true, config: result.data }
  }
  const message = `Invalid client config:\n${z.prettifyError(result.error)}`
  return { success: false, error: new ClientConfigError(message, result.error.issues) }
}

/** Validates an already-parsed value; throws {@link ClientConfigError} when invalid. */
export function parseClientConfig(input: unknown): ClientConfig {
  const result = safeParseClientConfig(input)
  if (!result.success) {
    throw result.error
  }
  return result.config
}

/** Parses and validates the text of a `client.config.json` file; throws {@link ClientConfigError}. */
export function parseClientConfigJson(json: string): ClientConfig {
  let input: unknown
  try {
    input = JSON.parse(json)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new ClientConfigError(`Client config is not valid JSON: ${reason}`)
  }
  return parseClientConfig(input)
}
