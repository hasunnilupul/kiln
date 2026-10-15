import config from '@payload-config'
import { headers as getHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { hasRole, outletIds } from '@/access/roles'
import { zonedDay } from '@/lib/dates'

import { ReportsView } from './ReportsView'

/** Reports for managers and admins (FR-70 to FR-73). */
export default async function ReportsPage() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  if (!user || user.collection !== 'users' || !hasRole(user, 'admin', 'manager')) redirect('/')

  const [settings, outlets] = await Promise.all([
    payload.findGlobal({ slug: 'system-settings', depth: 0, overrideAccess: true }),
    payload.find({
      collection: 'outlets',
      where: hasRole(user, 'admin') ? {} : { id: { in: outletIds(user) } },
      depth: 0,
      pagination: false,
      sort: 'name',
      overrideAccess: true,
    }),
  ])

  return (
    <ReportsView
      title={settings.displayName || 'Reports'}
      currency={settings.currency}
      locale={settings.locale}
      today={zonedDay(new Date(), settings.timezone)}
      outlets={outlets.docs.map((o) => ({ id: o.id, name: o.name }))}
    />
  )
}
