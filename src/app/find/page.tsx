'use client'

import Link from 'next/link'
import { useState } from 'react'

interface AIResult {
  id: string
  rank: number
  reason: string
  source: string
  title: string
  url: string
  asking_price: number | null
  annual_revenue: number | null
  cash_flow: number | null
  location: string | null
}

interface ApiResponse {
  success: boolean
  error?: string
  query?: string
  totalConsidered?: number
  results?: AIResult[]
}

const fmtMoney = (n: number | null) =>
  n != null ? `$${n.toLocaleString()}` : '—'

const SOURCE_DOTS: Record<string, string> = {
  synergy: 'oklch(0.6 0.16 252)',
  fcbb:    'oklch(0.6 0.15 290)',
  zoom:    'oklch(0.62 0.14 200)',
}

export default function FindListings() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<AIResult[]>([])
  const [totalConsidered, setTotalConsidered] = useState<number>(0)

  const runSearch = async () => {
    if (!query.trim() || loading) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const res = await fetch('/api/find-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })
      const data: ApiResponse = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setResults(data.results || [])
      setTotalConsidered(data.totalConsidered || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const css = `
    :root {
      --bg:           oklch(0.985 0.002 95);
      --surface:      #ffffff;
      --surface-2:    oklch(0.975 0.003 95);
      --border:       oklch(0.92 0.004 95);
      --border-strong:oklch(0.86 0.005 95);
      --text:         oklch(0.18 0.005 250);
      --text-2:       oklch(0.42 0.008 250);
      --text-3:       oklch(0.62 0.008 250);
      --text-4:       oklch(0.78 0.005 250);
      --accent:       oklch(0.58 0.18 252);
      --accent-soft:  oklch(0.95 0.04 252);
      --money:        oklch(0.42 0.13 155);
      --shadow-sm:    0 1px 2px 0 oklch(0.18 0.005 250 / 0.04);
      --shadow-md:    0 1px 3px 0 oklch(0.18 0.005 250 / 0.06), 0 4px 12px -4px oklch(0.18 0.005 250 / 0.05);
    }
    body { background: var(--bg) !important; }
    .df-find { font-feature-settings: 'ss01','cv11'; letter-spacing: -0.01em; color: var(--text); background: var(--bg); min-height: 100vh; }
    .df-find a { color: inherit; text-decoration: none; }
    .df-find textarea:focus { outline: none; border-color: var(--accent) !important; }
    .df-source-dot::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: var(--dot-color, #aaa); margin-right: 6px; vertical-align: middle; position: relative; top: -1px; }
    .df-num { font-variant-numeric: tabular-nums; letter-spacing: -0.015em; }
  `

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="df-find" style={{ fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px 80px' }}>

          {/* ── Header ── */}
          <header style={{ paddingBottom: 28, borderBottom: '1px solid var(--border)', marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Link href="/" style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: 'linear-gradient(135deg, oklch(0.58 0.18 252) 0%, oklch(0.5 0.2 270) 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: 13, fontWeight: 700,
                    boxShadow: 'var(--shadow-md)',
                  }}>D</Link>
                  <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, color: 'var(--text)' }}>
                    Find Listings
                  </h1>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
                  Describe your perfect acquisition. AI surfaces the top 10 matches.
                </p>
              </div>
              <Link href="/" style={{
                fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '6px 12px', fontWeight: 500, flexShrink: 0, marginTop: 2,
                boxShadow: 'var(--shadow-sm)',
              }}>
                ← Back
              </Link>
            </div>
          </header>

          {/* ── Search box ── */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: 20,
            boxShadow: 'var(--shadow-sm)', marginBottom: 24,
          }}>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSearch() }}
              placeholder="e.g. Profitable B2B SaaS with $1–3M cash flow, recurring revenue, low customer concentration. Or: Light-industrial service business in Texas or Florida, $500K–$1M SDE."
              rows={4}
              style={{
                width: '100%', border: '1px solid var(--border)', borderRadius: 10,
                padding: '10px 14px', fontSize: 13, color: 'var(--text)',
                background: 'var(--surface-2)', fontFamily: 'inherit',
                resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.55,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                {query.length}/4000 · ⌘/Ctrl+Enter to search
              </span>
              <button
                onClick={runSearch}
                disabled={loading || !query.trim()}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  background: loading || !query.trim() ? 'var(--surface-2)' : 'var(--accent)',
                  color: loading || !query.trim() ? 'var(--text-4)' : 'white',
                  border: '1px solid transparent',
                  fontSize: 13, fontWeight: 500, cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 150ms', whiteSpace: 'nowrap',
                  boxShadow: loading || !query.trim() ? 'none' : 'var(--shadow-md)',
                }}
              >
                {loading ? 'Thinking…' : 'Find matches'}
              </button>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div style={{
              background: 'oklch(0.97 0.03 25)', border: '1px solid oklch(0.88 0.05 25)',
              borderRadius: 10, padding: '12px 16px', marginBottom: 16,
              fontSize: 13, color: 'oklch(0.55 0.18 25)',
            }}>
              <strong>Error: </strong>{error}
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: '48px 20px', textAlign: 'center',
              fontSize: 13, color: 'var(--text-3)', boxShadow: 'var(--shadow-sm)',
            }}>
              Searching across stored listings…
            </div>
          )}

          {/* ── Results ── */}
          {!loading && results.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                  Top {results.length} match{results.length === 1 ? '' : 'es'}
                </h2>
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                  Considered {totalConsidered.toLocaleString()} listings
                </span>
              </div>

              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
              }}>
                {results.map((r, i) => (
                  <a
                    key={r.id}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 14,
                      padding: '18px 20px',
                      borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
                      transition: 'background 120ms',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    {/* Rank badge */}
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--accent-soft)', border: '1px solid oklch(0.88 0.06 252)',
                      color: 'var(--accent)', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginTop: 1,
                    }}>
                      {r.rank}
                    </div>

                    {/* Content */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 2 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>{r.title}</div>
                        <span
                          className="df-source-dot"
                          style={{
                            fontSize: 10, color: 'var(--text-3)', fontWeight: 500,
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                            flexShrink: 0, marginTop: 2,
                            '--dot-color': SOURCE_DOTS[r.source] || '#aaa',
                          } as React.CSSProperties}
                        >
                          {r.source}
                        </span>
                      </div>
                      {r.location && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>{r.location}</div>
                      )}
                      <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, margin: 0 }}>{r.reason}</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 10 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          Asking <span className="df-num" style={{ fontWeight: 600, color: 'var(--text)' }}>{fmtMoney(r.asking_price)}</span>
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          Revenue <span className="df-num" style={{ color: 'var(--text-2)' }}>{fmtMoney(r.annual_revenue)}</span>
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          Cash flow <span className="df-num" style={{ fontWeight: 600, color: 'var(--money)' }}>{fmtMoney(r.cash_flow)}</span>
                        </span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ── Empty state ── */}
          {!loading && !error && results.length === 0 && totalConsidered === 0 && query.length === 0 && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: '48px 20px', textAlign: 'center',
              fontSize: 13, color: 'var(--text-4)', boxShadow: 'var(--shadow-sm)',
            }}>
              Describe what you&apos;re looking for above to get started.
            </div>
          )}

        </div>
      </div>
    </>
  )
}
