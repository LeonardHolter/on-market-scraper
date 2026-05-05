import Link from 'next/link'
import React from 'react'

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg, #fafaf9)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px',
      fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif",
    }}>
      <Link href="/" style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32,
        textDecoration: 'none', color: 'var(--text, #222)',
      }}>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>Nemmis</span>
      </Link>
      {children}
    </div>
  )
}
