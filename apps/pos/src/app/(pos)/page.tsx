import config from '@payload-config'
import { headers as getHeaders } from 'next/headers'
import { getPayload } from 'payload'
import React from 'react'

import { hasRole, outletIds } from '@/access/roles'
import { getLicenceState, isLicenceUsable } from '@/lib/licence'
import { activeModules } from '@/lib/settings'

import { ChangePasswordForm } from './_components/ChangePasswordForm'
import { LoginForm } from './_components/LoginForm'
import { Till } from './_components/Till'
import type { Bootstrap } from './_lib/types'

/**
 * The cashier screen (FR-30 onwards). Signs staff in, sends users with a temporary password to
 * change it (FR-03), refuses to run without a valid licence (FR-04), then hands static data to the
 * client-side till.
 */
export default async function TillPage() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  const [settings, branding] = await Promise.all([
    payload.findGlobal({ slug: 'system-settings', depth: 0, overrideAccess: true }),
    payload.findGlobal({ slug: 'branding', depth: 1, overrideAccess: true }),
  ])
  const title = settings.displayName || 'POS'

  if (!isLicenceUsable()) {
    const state = getLicenceState()
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-2xl font-semibold">This POS is not licensed</h1>
          <p className="text-muted-foreground">
            {state?.status === 'invalid' ? state.message : 'The licence could not be checked.'}{' '}
            Contact your provider.
          </p>
        </div>
      </main>
    )
  }

  if (!user || user.collection !== 'users') return <LoginForm title={title} />
  if (user.mustChangePassword) return <ChangePasswordForm userId={user.id} name={user.name} />

  const [registers, methods] = await Promise.all([
    payload.find({
      collection: 'registers',
      where: {
        active: { equals: true },
        ...(hasRole(user, 'admin') ? {} : { outlet: { in: outletIds(user) } }),
      },
      depth: 1,
      pagination: false,
      sort: 'code',
      overrideAccess: true,
    }),
    payload.find({
      collection: 'payment-methods',
      where: { enabled: { equals: true } },
      depth: 0,
      pagination: false,
      sort: 'sortOrder',
      overrideAccess: true,
    }),
  ])

  const logo = typeof branding.logo === 'object' ? branding.logo : null
  const bootstrap: Bootstrap = {
    deviceUser: { id: user.id, name: user.name, role: user.role },
    settings: {
      displayName: title,
      currency: settings.currency,
      locale: settings.locale,
      timezone: settings.timezone,
      pricesIncludeTax: Boolean(settings.pricesIncludeTax),
      discountLimitPercent: settings.approvals?.discountLimitPercent ?? 0,
      modules: activeModules(settings),
      receipt: {
        paperWidthMm: settings.receipt?.paperWidthMm === '58' ? 58 : 80,
        showTaxBreakdown: settings.receipt?.showTaxBreakdown ?? true,
        showCashierName: settings.receipt?.showCashierName ?? true,
      },
    },
    branding: {
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      logoUrl: logo?.url ?? null,
      receiptHeader: branding.receiptHeader ?? null,
      receiptFooter: branding.receiptFooter ?? null,
      legalName: settings.legalName,
      address: settings.address ?? null,
      phone: settings.phone ?? null,
      taxRegistrationNo: settings.taxRegistrationNo ?? null,
    },
    registers: registers.docs.flatMap((r) =>
      typeof r.outlet === 'object'
        ? [
            {
              id: r.id,
              code: r.code,
              name: r.name,
              outletId: r.outlet.id,
              outletName: r.outlet.name,
            },
          ]
        : [],
    ),
    paymentMethods: methods.docs.map((m) => ({
      id: m.id,
      code: m.code,
      label: m.label,
      type: m.type,
      requiresReference: Boolean(m.requiresReference),
    })),
  }

  return <Till bootstrap={bootstrap} />
}
