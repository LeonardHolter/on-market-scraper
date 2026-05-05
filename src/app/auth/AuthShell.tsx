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
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'linear-gradient(135deg, oklch(0.58 0.18 252) 0%, oklch(0.5 0.2 270) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 13, fontWeight: 700,
        }}>D</div>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>Deal Flow</span>
      </Link>
      {children}
    </div>
  )
}
