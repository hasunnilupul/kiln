'use client'

import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'

import { api, ApiError, getActing, setActing } from '../_lib/api'
import { makeMoney } from '../_lib/money'
import type {
  Bootstrap,
  CatalogueCategory,
  CatalogueVariant,
  OpenShift,
  TillUser,
} from '../_lib/types'
import { SwitchUserDialog } from './dialogs/SwitchUserDialog'
import { OpenShiftPanel } from './OpenShiftPanel'
import { TillScreen } from './TillScreen'

const CATALOGUE_REFRESH_MS = 5 * 60 * 1000

const fetchCatalogue = () =>
  api<{ variants: CatalogueVariant[]; categories: CatalogueCategory[] }>('/api/pos/catalogue')

interface CurrentShift {
  user: TillUser
  shift: OpenShift | null
}

/**
 * Client-side till: loads the catalogue and the acting user's shift, then shows either the
 * open-shift screen (FR-60) or the checkout (FR-30 onwards). Branding colours come from settings
 * (FR-81).
 */
export function Till({ bootstrap }: { bootstrap: Bootstrap }) {
  const router = useRouter()
  const money = useMemo(
    () => makeMoney(bootstrap.settings.currency, bootstrap.settings.locale),
    [bootstrap.settings.currency, bootstrap.settings.locale],
  )
  const [catalogue, setCatalogue] = useState<{
    variants: CatalogueVariant[]
    categories: CatalogueCategory[]
  } | null>(null)
  const [current, setCurrent] = useState<CurrentShift | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401 && err.code === 'unauthenticated') {
        router.refresh()
        return
      }
      setError(err instanceof Error ? err.message : 'Something went wrong')
    },
    [router],
  )

  const loadShift = useCallback(() => {
    api<CurrentShift>('/api/pos/shifts/current').then(setCurrent).catch(handleError)
  }, [handleError])

  /** Fetches the catalogue again, so items added during the day reach the till. */
  const refreshCatalogue = useCallback(async () => {
    const fresh = await fetchCatalogue()
    setCatalogue(fresh)
    return fresh
  }, [])

  useEffect(() => {
    api<CurrentShift>('/api/pos/shifts/current').then(setCurrent).catch(handleError)
    fetchCatalogue().then(setCatalogue).catch(handleError)
    const timer = setInterval(
      () =>
        fetchCatalogue()
          .then(setCatalogue)
          .catch(() => undefined),
      CATALOGUE_REFRESH_MS,
    )
    return () => clearInterval(timer)
  }, [handleError])

  async function signOut() {
    setActing(null)
    await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
    router.refresh()
  }

  const acting = getActing()
  // On :root so dialogs, which render in a portal, are branded too. Colours are validated hex.
  const hex = (value: string, fallback: string) =>
    /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback
  const primary = hex(bootstrap.branding.primaryColor, '#0F766E')
  const brandCss = `:root{--primary:${primary};--primary-foreground:#ffffff;--ring:${primary};--brand-accent:${hex(bootstrap.branding.accentColor, '#F59E0B')}}`

  return (
    <div className="flex h-screen min-w-[1024px] flex-col bg-muted/40">
      <style>{brandCss}</style>
      <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
        {bootstrap.branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by Payload media, any size
          <img src={bootstrap.branding.logoUrl} alt="" className="h-8 w-auto" />
        ) : null}
        <span className="font-semibold">{bootstrap.settings.displayName}</span>
        {current?.shift && (
          <span className="rounded bg-muted px-2 py-1 text-sm">
            {current.shift.register.name} ({current.shift.register.code})
          </span>
        )}
        <span className="ml-auto text-sm">
          {current?.user.name ?? bootstrap.deviceUser.name}
          {acting && (
            <span className="text-muted-foreground">
              {' '}
              · switched from {bootstrap.deviceUser.name}
            </span>
          )}
        </span>
        <Button variant="outline" className="h-11" onClick={() => setSwitching(true)} title="F9">
          Switch user
        </Button>
        <Button variant="ghost" className="h-11" onClick={signOut}>
          Sign out
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {error}
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {!current || !catalogue ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Loading…
        </div>
      ) : current.shift ? (
        <TillScreen
          bootstrap={bootstrap}
          money={money}
          user={current.user}
          shift={current.shift}
          catalogue={catalogue}
          refreshCatalogue={refreshCatalogue}
          onShiftClosed={loadShift}
          onSwitchUser={() => setSwitching(true)}
          onError={handleError}
        />
      ) : (
        <OpenShiftPanel
          registers={bootstrap.registers}
          money={money}
          onOpened={loadShift}
          onError={handleError}
        />
      )}

      {switching && (
        <SwitchUserDialog
          deviceUser={bootstrap.deviceUser}
          onClose={() => setSwitching(false)}
          onSwitched={() => {
            setSwitching(false)
            setCurrent(null)
            loadShift()
          }}
        />
      )}
    </div>
  )
}
