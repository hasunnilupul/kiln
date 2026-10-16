import { redirect } from 'next/navigation'
import type { ServerProps } from 'payload'
import React from 'react'

function mustChangePassword(user: ServerProps['user']): boolean {
  return Boolean(user && 'mustChangePassword' in user && user.mustChangePassword)
}

/**
 * Shown above every admin page while the signed-in user still has to replace their initial
 * password (FR-03). Access control already limits them to their own account.
 */
export function PasswordChangeBanner({ payload, user }: ServerProps) {
  if (!mustChangePassword(user)) return null
  const accountUrl = `${payload.config.routes.admin}/account`
  return (
    <div
      role="alert"
      style={{
        padding: '12px 24px',
        background: 'var(--theme-warning-100)',
        color: 'var(--theme-warning-800)',
        borderBottom: '1px solid var(--theme-warning-200)',
      }}
    >
      You must change your password before you can continue.{' '}
      <a href={accountUrl} style={{ color: 'inherit', fontWeight: 600 }}>
        Change it now
      </a>
    </div>
  )
}

/** Sends users who must change their password from the dashboard to their account page. */
export function RedirectToAccount({ payload, user }: ServerProps) {
  if (mustChangePassword(user)) {
    redirect(`${payload.config.routes.admin}/account`)
  }
  return null
}
