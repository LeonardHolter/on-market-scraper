'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AccountActions({
  hasCustomer,
  isActive,
}: {
  hasCustomer: boolean
  isActive: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<'portal' | 'checkout' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const openPortal = async () => {
    setErr(null); setLoading('portal')
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'portal failed')
      window.location.href = data.url
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'portal failed')
      setLoading(null)
    }
  }

  const startCheckout = async () => {
    setErr(null); setLoading('checkout')
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'checkout failed')
      window.location.href = data.url
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'checkout failed')
      setLoading(null)
    }
  }

  return (
    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {err && (
        <div style={{
          background: 'oklch(0.97 0.03 25)', border: '1px solid oklch(0.88 0.05 25)',
          borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'oklch(0.55 0.18 25)',
        }}>{err}</div>
      )}

      {isActive ? (
        <button onClick={openPortal} disabled={loading !== null} style={primaryBtn}>
          {loading === 'portal' ? '…' : 'Manage subscription'}
        </button>
      ) : (
        <button onClick={startCheckout} disabled={loading !== null} style={primaryBtn}>
          {loading === 'checkout' ? '…' : 'Subscribe — $19 / month'}
        </button>
      )}

      {hasCustomer && !isActive && (
        <button onClick={openPortal} disabled={loading !== null} style={ghostBtn}>
          {loading === 'portal' ? '…' : 'View past invoices'}
        </button>
      )}

      <button
        onClick={() => router.push('/')}
        style={{ ...ghostBtn, color: 'var(--text-3)' }}
      >
        ← Back to dashboard
      </button>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  background: 'var(--accent)', color: 'white', border: 'none',
  borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn: React.CSSProperties = {
  background: 'var(--surface)', color: 'var(--text-2)',
  border: '1px solid var(--border)', borderRadius: 8,
  padding: '9px 14px', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}
