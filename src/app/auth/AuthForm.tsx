'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

interface Props {
  mode: 'sign-in' | 'sign-up'
}

export default function AuthForm({ mode }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [magicSent, setMagicSent] = useState(false)

  const supabase = createSupabaseBrowserClient()

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'sign-up') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        })
        if (error) throw error
        // If email confirmations are off, we get a session immediately. If on, prompt.
        const { data: sess } = await supabase.auth.getSession()
        if (sess.session) router.replace(next)
        else setMagicSent(true)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.replace(next)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const onMagicLink = async () => {
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      if (error) throw error
      setMagicSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send magic link')
    } finally {
      setLoading(false)
    }
  }

  if (magicSent) {
    return (
      <div style={panel}>
        <h1 style={title}>Check your email</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>
          We sent a sign-in link to <strong style={{ color: 'var(--text)' }}>{email}</strong>. Click it to continue.
        </p>
      </div>
    )
  }

  return (
    <div style={panel}>
      <h1 style={title}>{mode === 'sign-up' ? 'Create your account' : 'Sign in'}</h1>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8, marginBottom: 24 }}>
        {mode === 'sign-up'
          ? 'Unlimited listing access for $19/month after sign-up.'
          : 'Welcome back to Nemmis.'}
      </p>

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Email</span>
          <input
            type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Password</span>
          <input
            type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={8}
            style={inputStyle}
          />
        </label>

        {error && (
          <div style={{
            background: 'oklch(0.97 0.03 25)', border: '1px solid oklch(0.88 0.05 25)',
            borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'oklch(0.55 0.18 25)',
          }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={loading || !email || !password} style={primaryBtn(loading || !email || !password)}>
          {loading ? '…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0', color: 'var(--text-4)', fontSize: 11 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span>or</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <button type="button" onClick={onMagicLink} disabled={loading || !email} style={ghostBtn(loading || !email)}>
        Email me a magic link
      </button>

      <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
        {mode === 'sign-up' ? (
          <>Already have an account? <Link href={`/auth/sign-in?next=${encodeURIComponent(next)}`} style={linkStyle}>Sign in</Link></>
        ) : (
          <>No account yet? <Link href={`/auth/sign-up?next=${encodeURIComponent(next)}`} style={linkStyle}>Create one</Link></>
        )}
      </p>
    </div>
  )
}

const panel: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 14, padding: 32, boxShadow: 'var(--shadow-sm)',
  maxWidth: 420, width: '100%', boxSizing: 'border-box',
}
const title: React.CSSProperties = {
  fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, color: 'var(--text)',
}
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em',
}
const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)',
  fontFamily: 'inherit', outline: 'none',
}
const linkStyle: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? 'var(--surface-2)' : 'var(--accent)',
  color: disabled ? 'var(--text-4)' : 'white',
  border: '1px solid transparent', borderRadius: 8,
  padding: '10px 14px', fontSize: 13, fontWeight: 500,
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
  marginTop: 6,
})
const ghostBtn = (disabled: boolean): React.CSSProperties => ({
  background: 'var(--surface)', color: disabled ? 'var(--text-4)' : 'var(--text-2)',
  border: '1px solid var(--border)', borderRadius: 8,
  padding: '9px 14px', fontSize: 13, fontWeight: 500,
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', width: '100%',
})
