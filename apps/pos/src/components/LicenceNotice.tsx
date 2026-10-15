import type { ServerProps } from 'payload'
import React from 'react'

import { getLicenceState } from '../lib/licence'

/** Explains, above every admin page, why nothing is accessible while the licence is invalid (FR-04). */
export function LicenceBanner(_props: ServerProps) {
  const state = getLicenceState()
  if (state?.status !== 'invalid') return null
  return (
    <div
      role="alert"
      style={{
        padding: '12px 24px',
        background: 'var(--theme-error-100)',
        color: 'var(--theme-error-800)',
        borderBottom: '1px solid var(--theme-error-200)',
      }}
    >
      This POS is not licensed ({state.message}). Contact your provider to renew or correct the
      licence.
    </div>
  )
}
