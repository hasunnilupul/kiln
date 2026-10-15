import type { Outlet, Register, User } from '@/payload-types'
import {
  createLocalReq,
  type CollectionSlug,
  type Endpoint,
  type Payload,
  type PayloadRequest,
} from 'payload'

/**
 * Creates uniquely named fixtures and removes them (and their audit entries) afterwards, so
 * integration suites can run against a development database.
 */
export class Fixtures {
  readonly run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
  private created: { collection: CollectionSlug; id: number }[] = []
  private userCount = 0

  constructor(readonly payload: Payload) {}

  /** Registers an extra document (e.g. one created by an endpoint) for cleanup. */
  track(collection: CollectionSlug, id: number) {
    this.created.push({ collection, id })
  }

  async make<T>(collection: CollectionSlug, data: Record<string, unknown>): Promise<T> {
    const doc = await this.payload.create({ collection, data: data as never, overrideAccess: true })
    this.track(collection, doc.id as number)
    return doc as T
  }

  outlet(name = 'Outlet') {
    return this.make<Outlet>('outlets', { code: `O${this.created.length}${this.run}`, name })
  }

  register(outlet: Outlet, extra: Record<string, unknown> = {}) {
    return this.make<Register>('registers', {
      code: `R${this.created.length}${this.run}`,
      name: 'Till',
      outlet: outlet.id,
      nextSaleNumber: 1,
      ...extra,
    })
  }

  user(role: User['role'], outlets: Outlet[], extra: Record<string, unknown> = {}) {
    this.userCount += 1
    return this.make<User>('users', {
      email: `${role}-${this.userCount}-${this.run}@kiln.test`.toLowerCase(),
      password: 'correct-horse-battery',
      name: `${role} ${this.userCount}`,
      role,
      outlets: outlets.map((o) => o.id),
      mustChangePassword: false,
      ...extra,
    })
  }

  async cleanup() {
    const ids = this.created.map((doc) => String(doc.id))
    await this.payload.delete({
      collection: 'audit-log',
      where: { entityId: { in: ids } },
      overrideAccess: true,
    })
    for (const doc of [...this.created].reverse()) {
      await this.payload.delete({ collection: doc.collection, id: doc.id, overrideAccess: true })
    }
  }
}

/** The shape Payload gives `req.user`. */
export const asUser = (user: User) => ({ ...user, collection: 'users' as const })

/** Calls a custom endpoint handler as `user` with a JSON body and route params. */
export async function callEndpoint(
  payload: Payload,
  endpoint: Endpoint,
  options: {
    user?: User
    body?: unknown
    params?: Record<string, unknown>
    headers?: Record<string, string>
    /** Reuse a request, e.g. one carrying a test transaction that is rolled back afterwards. */
    req?: PayloadRequest
  } = {},
  // Response bodies are checked with toMatchObject; typing each one would add nothing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; body: any }> {
  const user = options.user ? asUser(options.user) : undefined
  const req = options.req ?? (await createLocalReq({ user }, payload))
  req.user = user ?? null
  req.headers = new Headers()
  req.data = (options.body ?? {}) as Record<string, unknown>
  req.routeParams = options.params ?? {}
  for (const [name, value] of Object.entries(options.headers ?? {})) req.headers.set(name, value)
  const response = await endpoint.handler(req)
  return { status: response.status, body: await response.json() }
}
