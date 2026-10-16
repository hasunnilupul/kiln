import type { ServerProps } from 'payload'
import React from 'react'

import { hasRole } from '../access/roles'

/** Links admins and managers from the admin navigation to the reports page (FR-70). */
export function ReportsLink({ user }: ServerProps) {
  if (
    !user ||
    !('role' in user) ||
    !hasRole({ ...user, collection: 'users' } as never, 'admin', 'manager')
  ) {
    return null
  }
  return (
    <a href="/reports" style={{ display: 'block', padding: '8px 0', fontWeight: 600 }}>
      Reports
    </a>
  )
}
