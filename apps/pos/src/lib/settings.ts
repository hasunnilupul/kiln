import type { ModulesConfig } from '@kiln/client-config'
import type { PayloadRequest } from 'payload'

import type { SystemSetting } from '../payload-types'
import { licensedModules } from './licence'

/** System settings inside the request's transaction. */
export function loadSettings(req: PayloadRequest): Promise<SystemSetting> {
  return req.payload.findGlobal({ slug: 'system-settings', depth: 0, overrideAccess: true, req })
}

/** Modules on in settings and granted by the licence. */
export function activeModules(settings: SystemSetting): ModulesConfig {
  const enabled = settings.modules ?? {}
  return licensedModules({
    inventory: Boolean(enabled.inventory),
    customers: Boolean(enabled.customers),
    discounts: Boolean(enabled.discounts),
    multiOutlet: Boolean(enabled.multiOutlet),
  })
}
