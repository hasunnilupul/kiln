import React from 'react'

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
