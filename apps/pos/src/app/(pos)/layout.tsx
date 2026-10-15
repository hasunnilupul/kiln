import React from 'react'

import './globals.css'

// Every page here reads the session and the database per request; none may be prerendered at
// build time, when no database exists.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'POS',
}

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
