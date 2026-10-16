import type { AdminViewServerProps } from 'payload'
import { redirect } from 'next/navigation'
import React from 'react'

/**
 * Replaces Payload's "create first user" form, which the builder refuses: anyone who reached the
 * builder first could otherwise make themselves owner. The first owner comes from the environment
 * on startup (BR-01); this page says how, and sends visitors on once an owner exists.
 */
export async function NoOwnerView({ initPageResult }: AdminViewServerProps) {
  const { req } = initPageResult
  const adminRoute = req.payload.config.routes.admin
  if (req.user) redirect(adminRoute)
  const { totalDocs } = await req.payload.count({ collection: 'users', overrideAccess: true, req })
  if (totalDocs > 0) redirect(`${adminRoute}/login`)

  return (
    <div style={{ width: '100%', maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 'var(--base)' }}>Kiln Builder</h1>
      <p style={{ marginBottom: 'var(--base)' }}>
        There is no owner yet. The builder does not sign up owners in the browser; it creates the
        first one from its environment when it starts.
      </p>
      <ol style={{ marginBottom: 'var(--base)', paddingLeft: 20 }}>
        <li>
          Set <code>BUILDER_OWNER_EMAIL</code> and <code>BUILDER_OWNER_PASSWORD</code> (at least 16
          characters) in the builder&apos;s <code>.env</code>.
        </li>
        <li>Restart the builder.</li>
        <li>
          <a href={`${adminRoute}/login`}>Sign in</a> with that email and password, and set up your
          authenticator app when asked.
        </li>
      </ol>
    </div>
  )
}
