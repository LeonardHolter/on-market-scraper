'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export const dynamic = 'force-dynamic'

function PricingInner() {
  const router = useRouter()
  const params = useSearchParams()
  const cancelled = params.get('checkout') === 'cancelled'
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }: { data: { user: unknown } }) => setAuthed(!!data.user))
  }, [])

  const onSubscribe = async () => {
    setErr(null)
    if (!authed) {
      router.push('/auth/sign-up?next=/pricing')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'checkout failed')
      window.location.href = data.url
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'checkout failed')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg, #fafaf9)',
      fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif",
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 580, margin: '0 auto' }}>
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 32,
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

        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', margin: 0, color: 'var(--text)' }}>
          One plan. All listings.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 8, marginBottom: 28 }}>
          Track every actively-marketed business across our broker network. Cancel anytime.
        </p>

        {cancelled && (
          <div style={{
            background: 'oklch(0.96 0.04 65)', border: '1px solid oklch(0.85 0.08 65)',
            borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'oklch(0.45 0.15 65)',
            marginBottom: 20,
          }}>
            Checkout cancelled — no charge made.
          </div>
        )}

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 28, boxShadow: 'var(--shadow-md)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--text)' }}>$19</span>
            <span style={{ fontSize: 14, color: 'var(--text-3)' }}>/ month</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '4px 0 0' }}>Billed monthly · cancel anytime</p>

          <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              'Unlimited listing clicks',
              'Daily refresh from every broker',
              'State, price, and cash-flow filters',
              'Price-change & sold alerts in your feed',
              'AI search to surface the right deal',
            ].map((f) => (
              <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-2)' }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                {f}
              </li>
            ))}
          </ul>

          {err && (
            <div style={{
              background: 'oklch(0.97 0.03 25)', border: '1px solid oklch(0.88 0.05 25)',
              borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'oklch(0.55 0.18 25)', marginTop: 16,
            }}>
              {err}
            </div>
          )}

          <button
            onClick={onSubscribe}
            disabled={loading || authed === null}
            style={{
              width: '100%', marginTop: 24,
              background: 'var(--accent)', color: 'white',
              border: 'none', borderRadius: 10,
              padding: '12px 16px', fontSize: 14, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Redirecting…' : authed ? 'Subscribe — $19 / month' : 'Sign up & subscribe'}
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 12, textAlign: 'center' }}>
            Anonymous visitors get 3 free listing views.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function PricingPage() {
  return <Suspense><PricingInner /></Suspense>
}
