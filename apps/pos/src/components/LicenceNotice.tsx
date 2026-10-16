import type { ServerProps } from 'payload'
import React from 'react'

import { getLicenceState } from '../lib/licence'

const banner = (tone: 'error' | 'warning'): React.CSSProperties => ({
  padding: '12px 24px',
  background: `var(--theme-${tone}-100)`,
  color: `var(--theme-${tone}-800)`,
  borderBottom: `1px solid var(--theme-${tone}-200)`,
})

/**
 * Explains, above every admin page, why nothing is accessible while the licence is invalid
 * (FR-04), and warns while online check-ins fail, before the grace period ends (BR-32).
 */
export function LicenceBanner(_props: ServerProps) {
  const state = getLicenceState()
  if (state?.status === 'invalid') {
    return (
      <div role="alert" style={banner('error')}>
        This POS is not licensed ({state.message}). Contact your provider to renew or correct the
        licence.
      </div>
    )
  }
  if (state?.status === 'valid' && state.checkIn?.lockAt) {
    const lockAt = new Date(state.checkIn.lockAt).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    return (
      <div role="alert" style={banner('warning')}>
        The licence could not be confirmed with your provider ({state.checkIn.failing}). Check the
        server&apos;s internet connection; the POS stops working on {lockAt} if this continues.
      </div>
    )
  }
  return null
}
