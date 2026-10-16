import type { AdminViewServerProps } from 'payload'
import { redirect } from 'next/navigation'
import { getSafeRedirect } from 'payload/shared'
import React from 'react'

import { SignInForm } from './SignInForm'

/**
 * Replaces Payload's login view: email, password and TOTP code, posted to `/api/auth/sign-in`
 * (BR-01). Payload's own login route refuses every request, so this is the only way in.
 */
export function SignInView({ initPageResult, searchParams }: AdminViewServerProps) {
  const { req } = initPageResult
  const adminRoute = req.payload.config.routes.admin
  const redirectTo = getSafeRedirect({
    fallbackTo: adminRoute,
    redirectTo: typeof searchParams?.redirect === 'string' ? searchParams.redirect : '',
  })
  if (req.user) redirect(redirectTo)

  return (
    <div style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 'var(--base)' }}>Kiln Builder</h1>
      <SignInForm
        endpoint={`${req.payload.config.routes.api}/auth/sign-in`}
        redirectTo={redirectTo}
      />
    </div>
  )
}
