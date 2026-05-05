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
  synergy: '#4f6ef7',
  fcbb:    '#7c5cbf',
  zoom:    '#2a9d8f',
  viking:  '#c0392b',
  murphy:  '#e67e22',
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
    body { background: #faf9f7 !important; color: #1a1a2e !important; }
    .df-find { font-feature-settings: 'ss01','cv11'; letter-spacing: -0.01em; color: #1a1a2e; background: #faf9f7; min-height: 100vh; }
    .df-find a { color: inherit; text-decoration: none; }
    .df-find textarea:focus { outline: none; border-color: #4f6ef7 !important; }
    .df-source-dot::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: var(--dot-color, #aaa); margin-right: 6px; vertical-align: middle; position: relative; top: -1px; }
    .df-num { font-variant-numeric: tabular-nums; letter-spacing: -0.015em; }
  `

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="df-find" style={{ fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px 80px' }}>

          {/* ── Header ── */}
          <header style={{ paddingBottom: 28, borderBottom: '1px solid #e8e6e1', marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, color: '#1a1a2e' }}>
                    Find Listings
                  </h1>
                </div>
                <p style={{ fontSize: 13, color: '#7a7a9a', margin: 0 }}>
                  Describe your perfect acquisition. AI surfaces the top 10 matches.
                </p>
              </div>
              <Link href="/" style={{
                fontSize: 12, color: '#7a7a9a', display: 'flex', alignItems: 'center', gap: 4,
                background: '#ffffff', border: '1px solid #e8e6e1', borderRadius: 8,
                padding: '6px 12px', fontWeight: 500, flexShrink: 0, marginTop: 2,
                boxShadow: '0 1px 2px 0 rgba(26,26,46,0.04)',
              }}>
                ← Back
              </Link>
            </div>
          </header>

          {/* ── Search box ── */}
          <div style={{
            background: '#ffffff', border: '1px solid #e8e6e1',
            borderRadius: 14, padding: 20,
            boxShadow: '0 1px 2px 0 rgba(26,26,46,0.04)', marginBottom: 24,
          }}>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSearch() }}
              placeholder="e.g. Profitable B2B SaaS with $1–3M cash flow, recurring revenue, low customer concentration. Or: Light-industrial service business in Texas or Florida, $500K–$1M SDE."
              rows={4}
              style={{
                width: '100%', border: '1px solid #e8e6e1', borderRadius: 10,
                padding: '10px 14px', fontSize: 13, color: '#1a1a2e',
                background: '#f5f4f1', fontFamily: 'inherit',
                resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.55,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: '#a8a8c0' }}>
                {query.length}/4000 · ⌘/Ctrl+Enter to search
              </span>
              <button
                onClick={runSearch}
                disabled={loading || !query.trim()}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  background: loading || !query.trim() ? '#f5f4f1' : '#4f6ef7',
                  color: loading || !query.trim() ? '#a8a8c0' : 'white',
                  border: '1px solid transparent',
                  fontSize: 13, fontWeight: 500, cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 150ms', whiteSpace: 'nowrap',
                  boxShadow: loading || !query.trim() ? 'none' : '0 1px 3px 0 rgba(26,26,46,0.06), 0 4px 12px -4px rgba(26,26,46,0.05)',
                }}
              >
                {loading ? 'Thinking…' : 'Find matches'}
              </button>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 10, padding: '12px 16px', marginBottom: 16,
              fontSize: 13, color: '#b91c1c',
            }}>
              <strong>Error: </strong>{error}
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div style={{
              background: '#ffffff', border: '1px solid #e8e6e1',
              borderRadius: 14, padding: '48px 20px', textAlign: 'center',
              fontSize: 13, color: '#7a7a9a', boxShadow: '0 1px 2px 0 rgba(26,26,46,0.04)',
            }}>
              Searching across stored listings…
            </div>
          )}

          {/* ── Results ── */}
          {!loading && results.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ fontSize: 11, fontWeight: 600, color: '#7a7a9a', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                  Top {results.length} match{results.length === 1 ? '' : 'es'}
                </h2>
                <span style={{ fontSize: 11, color: '#a8a8c0' }}>
                  Considered {totalConsidered.toLocaleString()} listings
                </span>
              </div>

              <div style={{
                background: '#ffffff', border: '1px solid #e8e6e1',
                borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px 0 rgba(26,26,46,0.04)',
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
                      borderBottom: i < results.length - 1 ? '1px solid #e8e6e1' : 'none',
                      transition: 'background 120ms',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f5f4f1' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    {/* Rank badge */}
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: '#eef1fe', border: '1px solid #c7d2fd',
                      color: '#4f6ef7', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginTop: 1,
                    }}>
                      {r.rank}
                    </div>

                    {/* Content */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 2 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', lineHeight: 1.4 }}>{r.title}</div>
                        <span
                          className="df-source-dot"
                          style={{
                            fontSize: 10, color: '#7a7a9a', fontWeight: 500,
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                            flexShrink: 0, marginTop: 2,
                            '--dot-color': SOURCE_DOTS[r.source] || '#aaa',
                          } as React.CSSProperties}
                        >
                          {r.source}
                        </span>
                      </div>
                      {r.location && (
                        <div style={{ fontSize: 11, color: '#7a7a9a', marginBottom: 6 }}>{r.location}</div>
                      )}
                      <p style={{ fontSize: 12, color: '#4a4a6a', lineHeight: 1.55, margin: 0 }}>{r.reason}</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 10 }}>
                        <span style={{ fontSize: 11, color: '#7a7a9a' }}>
                          Asking <span className="df-num" style={{ fontWeight: 600, color: '#1a1a2e' }}>{fmtMoney(r.asking_price)}</span>
                        </span>
                        <span style={{ fontSize: 11, color: '#7a7a9a' }}>
                          Revenue <span className="df-num" style={{ color: '#4a4a6a' }}>{fmtMoney(r.annual_revenue)}</span>
                        </span>
                        <span style={{ fontSize: 11, color: '#7a7a9a' }}>
                          Cash flow <span className="df-num" style={{ fontWeight: 600, color: '#1a6b3a' }}>{fmtMoney(r.cash_flow)}</span>
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
              background: '#ffffff', border: '1px solid #e8e6e1',
              borderRadius: 14, padding: '48px 20px', textAlign: 'center',
              fontSize: 13, color: '#a8a8c0', boxShadow: '0 1px 2px 0 rgba(26,26,46,0.04)',
            }}>
              Describe what you&apos;re looking for above to get started.
            </div>
          )}

        </div>
      </div>
    </>
  )
}
