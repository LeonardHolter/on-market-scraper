'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

interface Entitlement {
  isAuthed: boolean
  isSubscribed: boolean
  shouldPaywall: boolean
  email: string | null
  clicksUsed: number
  clicksRemaining: number
  limit: number
}

interface StoredListing {
  id: string
  source: string
  source_listing_url: string
  title: string
  asking_price_text: string | null
  asking_price: number | null
  annual_revenue_text: string | null
  annual_revenue: number | null
  cash_flow_text: string | null
  cash_flow: number | null
  location: string | null
  status: string | null
  first_seen_at: string
  last_seen_at: string
  is_sold: boolean | null
  sold_detected_at: string | null
  previous_asking_price: number | null
  price_changed_at: string | null
  previous_title: string | null
  title_changed_at: string | null
  delisted_at: string | null
  is_hidden: boolean | null
}

interface SiteConfig {
  name: string
  source: string
  phase: number
  url: string
  endpoint: string
}

const SITES: SiteConfig[] = [
  { name: 'Synergy Business Brokers',      source: 'synergy', phase: 1, url: 'synergybb.com',           endpoint: '/api/scrape/synergy' },
  { name: 'First Choice Business Brokers', source: 'fcbb',    phase: 1, url: 'fcbb.com',                endpoint: '/api/scrape/fcbb' },
  { name: 'Zoom Business Brokers',         source: 'zoom',    phase: 1, url: 'zoombusinessbrokers.com', endpoint: '/api/scrape/zoom' },
]

const SOURCE_DOTS: Record<string, string> = {
  synergy: '#4f6ef7',
  fcbb:    '#7c5cbf',
  zoom:    '#2a9d8f',
}

interface ScrapeStatus {
  loading: boolean
  error: string | null
  storage: {
    total: number
    inserted: number
    updated: number
    errors: number
    priceChanged?: number
    titleChanged?: number
    newlySold?: number
    delisted?: number
  } | null
  scrapedAt: string | null
}

const emptyStatus: ScrapeStatus = { loading: false, error: null, storage: null, scrapedAt: null }
const HOUR_MS = 60 * 60 * 1000

export default function Home() {
  const [enabledSources, setEnabledSources] = useState<Set<string>>(
    () => new Set(SITES.map((s) => s.source))
  )
  const [stored, setStored] = useState<StoredListing[]>([])
  const [bySource, setBySource] = useState<Record<string, number>>({})
  const [storedLoading, setStoredLoading] = useState(true)
  const [storedError, setStoredError] = useState<string | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<Record<string, ScrapeStatus>>({})
  const [lastAutoRun, setLastAutoRun] = useState<string | null>(null)
  const [minCashFlow, setMinCashFlow] = useState<number>(400_000)
  const [cashFlowInput, setCashFlowInput] = useState('400000')
  const [maxAskingPrice, setMaxAskingPrice] = useState<number>(10_000_000)
  const [maxPriceInput, setMaxPriceInput] = useState('10000000')
  const [hideFranchises, setHideFranchises] = useState(true)
  const [excludeKeywords, setExcludeKeywords] = useState<string>('')
  const [sortBy, setSortBy] = useState<'location' | 'asking_price' | 'annual_revenue' | 'cash_flow' | 'first_seen_at'>('cash_flow')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [now, setNow] = useState<number>(() => Date.now())
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [paywallOpen, setPaywallOpen] = useState(false)
  const [pendingClickId, setPendingClickId] = useState<string | null>(null)
  const lastRunRef = useRef<number>(0)

  // Fetch entitlement on mount so we can render the free-click counter
  useEffect(() => {
    fetch('/api/track-click')
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          const ent: Entitlement = {
            isAuthed: d.isAuthed, isSubscribed: d.isSubscribed, shouldPaywall: !!d.shouldPaywall, email: d.email ?? null,
            clicksUsed: d.clicksUsed, clicksRemaining: d.clicksRemaining, limit: d.limit,
          }
          setEntitlement(ent)
          // Auto-open paywall if already over limit on page load
          if (ent.shouldPaywall && !ent.isSubscribed) setPaywallOpen(true)
        }
      })
      .catch(() => {})
  }, [])

  const handleListingClick = useCallback(
    async (listing: StoredListing, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (pendingClickId) return
      setPendingClickId(listing.id)
      try {
        const res = await fetch('/api/track-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: listing.id }),
        })
        const data = await res.json()
        if (data?.paywall) {
          setEntitlement((prev) => prev ? { ...prev, clicksUsed: data.clicksUsed, clicksRemaining: 0, isAuthed: data.isAuthed, isSubscribed: data.isSubscribed, shouldPaywall: true } : prev)
          setPaywallOpen(true)
          return
        }
        if (data?.ok && data.redirect) {
          setEntitlement((prev) => prev ? { ...prev, clicksUsed: data.clicksUsed, clicksRemaining: data.clicksRemaining, isAuthed: data.isAuthed, isSubscribed: data.isSubscribed, shouldPaywall: !!data.shouldPaywall } : prev)
          window.open(data.redirect, '_blank', 'noopener,noreferrer')
        }
      } catch {
        // Fallback: open the listing anyway so we never block the user on a network blip
        if (listing.source_listing_url) window.open(listing.source_listing_url, '_blank', 'noopener,noreferrer')
      } finally {
        setPendingClickId(null)
      }
    },
    [pendingClickId]
  )

  const refreshStored = useCallback(async (source: string | null = null) => {
    setStoredLoading(true)
    setStoredError(null)
    try {
      const url = source ? `/api/broker-listings?source=${source}` : '/api/broker-listings'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setStored(data.listings)
      setBySource(data.bySource || {})
    } catch (e) {
      setStoredError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setStoredLoading(false)
    }
  }, [])

  useEffect(() => { refreshStored(null) }, [refreshStored])

  const runScrape = useCallback(
    async (site: SiteConfig) => {
      setScrapeStatus((s) => ({ ...s, [site.source]: { ...emptyStatus, loading: true } }))
      try {
        const res = await fetch(site.endpoint, { method: 'POST' })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
        setScrapeStatus((s) => ({
          ...s,
          [site.source]: { loading: false, error: null, storage: data.storage, scrapedAt: data.scrapedAt },
        }))
      } catch (e) {
        setScrapeStatus((s) => ({
          ...s,
          [site.source]: { loading: false, error: e instanceof Error ? e.message : 'Scrape failed', storage: null, scrapedAt: null },
        }))
      } finally {
        await refreshStored(null)
      }
    },
    [refreshStored]
  )

  useEffect(() => {
    const tick = async () => {
      const now = Date.now()
      if (now - lastRunRef.current < HOUR_MS) return
      lastRunRef.current = now
      for (const site of SITES) await runScrape(site)
      setLastAutoRun(new Date().toISOString())
    }
    const initial = setTimeout(() => { lastRunRef.current = Date.now() - HOUR_MS; tick() }, 30_000)
    const interval = setInterval(tick, 60_000)
    return () => { clearTimeout(initial); clearInterval(interval) }
  }, [runScrape])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const nextRescrapeAt = (() => {
    const next = new Date(now)
    next.setUTCHours(5, 0, 0, 0)
    if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1)
    return next.getTime()
  })()
  const msUntilRescrape = Math.max(0, nextRescrapeAt - now)
  const fmtCountdown = (ms: number) => {
    const t = Math.floor(ms / 1000)
    const h = Math.floor(t / 3600)
    const m = Math.floor((t % 3600) / 60)
    const s = t % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const totalStored = Object.values(bySource).reduce((a, b) => a + b, 0)

  const activeStatus = (() => {
    let latest: ScrapeStatus | null = null
    let latestTs = 0
    for (const s of Object.values(scrapeStatus)) {
      if (!s.scrapedAt) continue
      const t = new Date(s.scrapedAt).getTime()
      if (t > latestTs) { latestTs = t; latest = s }
    }
    return latest
  })()

  const excludedKeywordList = excludeKeywords.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

  const visibleListings = stored.filter((l) => {
    if (!enabledSources.has(l.source)) return false
    if (l.is_sold || l.delisted_at) return false
    if (l.is_hidden) return false
    if (l.cash_flow == null) return false
    if (minCashFlow > 0 && l.cash_flow < minCashFlow) return false
    if (hideFranchises && /\bfranchise[sd]?\b/i.test(l.title)) return false
    if (maxAskingPrice > 0 && l.asking_price != null && l.asking_price > maxAskingPrice) return false
    if (excludedKeywordList.length > 0) {
      const lower = l.title.toLowerCase()
      if (excludedKeywordList.some((kw) => lower.includes(kw))) return false
    }
    return true
  })

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir(col === 'location' ? 'asc' : 'desc') }
  }

  const sortedListings = [...visibleListings].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'location') {
      const la = (a.location ?? '').toLowerCase()
      const lb = (b.location ?? '').toLowerCase()
      cmp = la < lb ? -1 : la > lb ? 1 : 0
    } else if (sortBy === 'first_seen_at') {
      cmp = new Date(a.first_seen_at).getTime() - new Date(b.first_seen_at).getTime()
    } else {
      const va = a[sortBy] ?? -Infinity
      const vb = b[sortBy] ?? -Infinity
      cmp = (va as number) - (vb as number)
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const fmtMoneyCompact = (n: number | null): string => {
    if (n == null) return '—'
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
    return `$${n.toLocaleString()}`
  }

  const fmtMoneyFull = (n: number | null, fallback: string | null) =>
    n != null ? `$${n.toLocaleString()}` : fallback || '—'

  const activity = stored
    .flatMap<{ ts: string; kind: 'sold' | 'price' | 'delisted'; listing: StoredListing }>((l) => {
      const events: { ts: string; kind: 'sold' | 'price' | 'delisted'; listing: StoredListing }[] = []
      if (l.sold_detected_at) events.push({ ts: l.sold_detected_at, kind: 'sold', listing: l })
      if (l.price_changed_at) events.push({ ts: l.price_changed_at, kind: 'price', listing: l })
      if (l.delisted_at) events.push({ ts: l.delisted_at, kind: 'delisted', listing: l })
      return events
    })
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 10)

  const sortArrow = (col: typeof sortBy) => {
    if (sortBy !== col) return <span style={{ opacity: 0.25, marginLeft: 4 }}>↕</span>
    return <span style={{ marginLeft: 4, color: 'var(--accent)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // ─── CSS variables ────────────────────────────────────────────────────────
  const css = `
    body { background: #faf9f7 !important; color: #1a1a2e !important; }
    .df-page { font-feature-settings: 'ss01','cv11'; letter-spacing: -0.01em; color: #1a1a2e; background: #faf9f7; min-height: 100vh; }
    .df-mono { font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .df-num  { font-variant-numeric: tabular-nums; letter-spacing: -0.015em; }
    .df-table-wrap { background: #ffffff; border: 1px solid #e8e6e1; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px 0 rgba(26,26,46,0.04); }
    .df-table { width: 100%; border-collapse: separate; border-spacing: 0; }
    .df-table thead th { background: #f5f4f1; text-align: left; font-size: 11px; font-weight: 500; color: #7a7a9a; text-transform: uppercase; letter-spacing: 0.06em; padding: 13px 20px; border-bottom: 1px solid #e8e6e1; white-space: nowrap; }
    .df-table thead th.sortable { cursor: pointer; user-select: none; }
    .df-table thead th.sortable:hover { color: #4a4a6a; }
    .df-table tbody td { padding: 16px 20px; vertical-align: middle; border-bottom: 1px solid #e8e6e1; font-size: 13px; color: #1a1a2e; }
    .df-table tbody tr:last-child td { border-bottom: none; }
    .df-table tbody tr:hover { background: #f5f4f1; }
    .df-source-dot::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: var(--dot-color, #aaa); margin-right: 6px; vertical-align: middle; position: relative; top: -1px; }
    .df-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    .df-card { background: #ffffff; border: 1px solid #e8e6e1; border-radius: 12px; box-shadow: 0 1px 2px 0 rgba(26,26,46,0.04); }
    .df-input { background: #f5f4f1; border: 1px solid #e8e6e1; border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 500; outline: none; color: #1a1a2e; font-family: inherit; font-variant-numeric: tabular-nums; }
    .df-input:focus { border-color: #4f6ef7; }
    .df-btn-accent { background: #eef1fe; color: #4f6ef7; border: 1px solid transparent; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 6px; transition: opacity 150ms; }
    .df-btn-accent:hover { opacity: 0.8; }
    .df-btn-ghost { background: #ffffff; color: #7a7a9a; border: 1px solid #e8e6e1; border-radius: 6px; padding: 5px 10px; font-size: 11px; font-weight: 500; cursor: pointer; font-family: inherit; transition: all 150ms; }
    .df-btn-ghost:hover { border-color: #d4d1ca; color: #4a4a6a; }
    .df-btn-active { background: #eef1fe !important; color: #4f6ef7 !important; border-color: transparent !important; }
    .df-source-card { background: #ffffff; border: 1px solid #e8e6e1; border-radius: 12px; padding: 18px; cursor: pointer; transition: all 150ms; box-shadow: 0 1px 2px 0 rgba(26,26,46,0.04); text-align: left; width: 100%; }
    .df-source-card:hover { border-color: #d4d1ca; transform: translateY(-1px); box-shadow: 0 1px 3px 0 rgba(26,26,46,0.06), 0 4px 12px -4px rgba(26,26,46,0.05); }
    .df-source-card.active { border-color: #4f6ef7; background: #eef1fe; }
  `

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="df-page" style={{ fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
        <div style={{
          maxWidth: 1260, margin: '0 auto', padding: '40px 32px 80px',
          ...(entitlement?.shouldPaywall && !entitlement?.isSubscribed ? {
            filter: 'blur(6px)',
            pointerEvents: 'none',
            userSelect: 'none',
          } : {}),
        }}>

          {/* ── Header ───────────────────────────────────────────────────── */}
          <header style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            paddingBottom: 28, borderBottom: '1px solid var(--border)', marginBottom: 32,
            flexWrap: 'wrap', gap: 20,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 9,
                  background: 'linear-gradient(135deg, #4f6ef7 0%, #6c4de8 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0,
                  boxShadow: 'var(--shadow-md)',
                }}>D</div>
                <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, color: 'var(--text)' }}>
                  Deal Flow
                </h1>
                <span className="df-pill" style={{ background: '#d1fae5', color: '#065f46' }}>
                  <span style={{ width: 5, height: 5, borderRadius: 999, background: '#10b981', display: 'inline-block' }} />
                  Live
                </span>

              </div>
              <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
                Broker listings refreshed daily at 12:00 AM EST
                {lastAutoRun && (
                  <span style={{ color: 'var(--text-4)', marginLeft: 6 }}>
                    · last run {new Date(lastAutoRun).toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <div style={{ textAlign: 'right' }}>
                <div className="df-mono" style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em', color: '#1a1a2e', lineHeight: 1 }}>
                  {fmtCountdown(msUntilRescrape)}
                </div>
                <div style={{ fontSize: 11, color: '#7a7a9a', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 5 }}>
                  Next refresh
                </div>
              </div>
              <div style={{ width: 1, height: 40, background: '#e8e6e1' }} />
              <div style={{ textAlign: 'right' }}>
                <div className="df-num" style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em', color: '#1a1a2e', lineHeight: 1 }}>
                  {totalStored.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: '#7a7a9a', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 5 }}>
                  Stored
                </div>
              </div>
              <div style={{ width: 1, height: 40, background: '#e8e6e1' }} />
              <Link href={entitlement?.isAuthed ? '/account' : '/auth/sign-in'} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                fontSize: 13, fontWeight: 500, color: '#4a4a6a',
                background: '#ffffff', border: '1px solid #e8e6e1',
                borderRadius: 8, padding: '8px 14px', textDecoration: 'none',
                boxShadow: '0 1px 2px 0 rgba(26,26,46,0.04)',
              }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M2.5 13.5c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {entitlement?.isAuthed ? 'Account' : 'Sign in'}
              </Link>
            </div>
          </header>

          {/* ── Subscription nudge banner ────────────────────────────────── */}
          {entitlement && !entitlement.isSubscribed && entitlement.shouldPaywall && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fcd34d',
              borderRadius: 12, padding: '14px 18px', marginBottom: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🔒</span>
                <span style={{ fontSize: 13, color: '#92400e', fontWeight: 500 }}>
                  You&apos;ve used your 3 free listing previews.
                </span>
                <span style={{ fontSize: 13, color: '#b45309' }}>
                  Subscribe to keep using Deal Flow.
                </span>
              </div>
              <Link
                href={entitlement.isAuthed ? '/pricing' : '/auth/sign-up?next=/pricing'}
                style={{
                  fontSize: 13, fontWeight: 600, color: 'white',
                  background: '#d97706', borderRadius: 7,
                  padding: '7px 16px', textDecoration: 'none', flexShrink: 0,
                }}
              >
                {entitlement.isAuthed ? 'Subscribe — $19/mo' : 'Sign up & subscribe'}
              </Link>
            </div>
          )}

          {/* ── Source cards ─────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
            {SITES.map((site) => {
              const status = scrapeStatus[site.source]
              const count = bySource[site.source] || 0
              const isLoading = status?.loading
              const isEnabled = enabledSources.has(site.source)
              return (
                <div key={site.source} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <button
                    className={`df-source-card${isEnabled ? ' active' : ''}`}
                    onClick={() =>
                      setEnabledSources((prev) => {
                        const next = new Set(prev)
                        if (next.has(site.source)) next.delete(site.source)
                        else next.add(site.source)
                        return next
                      })
                    }
                    style={{ opacity: isEnabled ? 1 : 0.45 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{site.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{site.url}</div>
                      </div>
                      <div style={{
                        width: 7, height: 7, borderRadius: 999, flexShrink: 0, marginLeft: 10, marginTop: 3,
                        background: isLoading ? '#4f6ef7' : count > 0 ? '#10b981' : '#a8a8c0',
                      }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <div className="df-num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--text)' }}>
                        {isLoading ? '…' : count.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>active listings</div>
                    </div>
                  </button>
                  <button
                    onClick={() => runScrape(site)}
                    disabled={isLoading}
                    style={{
                      marginTop: 6, padding: '6px 0', fontSize: 11, color: isLoading ? 'var(--accent)' : 'var(--text-4)',
                      background: 'none', border: 'none', cursor: isLoading ? 'default' : 'pointer',
                      fontFamily: 'inherit', textAlign: 'center', letterSpacing: '-0.01em',
                    }}
                  >
                    {isLoading ? 'Scraping…' : status?.error ? '⚠ Error — re-scrape' : '↺ Re-scrape'}
                  </button>
                </div>
              )
            })}
          </div>

          {/* ── Errors ───────────────────────────────────────────────────── */}
          {(activeStatus?.error || storedError) && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 10, padding: '12px 16px', marginBottom: 16,
              fontSize: 13, color: 'var(--danger)',
            }}>
              {activeStatus?.error && <div><strong>Scrape error:</strong> {activeStatus.error}</div>}
              {storedError && <div><strong>Database error:</strong> {storedError}</div>}
            </div>
          )}

          {/* ── Filter bar ───────────────────────────────────────────────── */}
          <div className="df-card" style={{ padding: '12px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            {/* Min cash flow */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Min cash flow</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px' }}>
                <span style={{ color: 'var(--text-4)', fontSize: 12 }}>$</span>
                <input
                  type="number"
                  value={cashFlowInput}
                  onChange={(e) => {
                    setCashFlowInput(e.target.value)
                    const n = parseInt(e.target.value, 10)
                    if (!isNaN(n)) setMinCashFlow(n)
                    else if (e.target.value === '') setMinCashFlow(0)
                  }}
                  placeholder="0"
                  style={{ width: 80, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 500, outline: 'none', color: 'var(--text)', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}
                />
              </div>
            </div>

            {/* Max asking */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Max asking</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px' }}>
                <span style={{ color: 'var(--text-4)', fontSize: 12 }}>$</span>
                <input
                  type="number"
                  value={maxPriceInput}
                  onChange={(e) => {
                    setMaxPriceInput(e.target.value)
                    const n = parseInt(e.target.value, 10)
                    if (!isNaN(n)) setMaxAskingPrice(n)
                    else if (e.target.value === '') setMaxAskingPrice(0)
                  }}
                  placeholder="∞"
                  style={{ width: 90, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 500, outline: 'none', color: 'var(--text)', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}
                />
              </div>
            </div>

            {/* Hide franchises */}
            <button
              className={`df-btn-accent${!hideFranchises ? '' : ''}`}
              onClick={() => setHideFranchises((v) => !v)}
              style={hideFranchises ? {} : { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                {hideFranchises
                  ? <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  : <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                }
              </svg>
              {hideFranchises ? 'Hiding franchises' : 'Show franchises'}
            </button>

            {/* Exclude keywords */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Exclude</span>
              <input
                type="text"
                value={excludeKeywords}
                onChange={(e) => setExcludeKeywords(e.target.value)}
                placeholder="keywords, comma-separated"
                style={{ width: 180, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 8, padding: '5px 10px', fontSize: 12, outline: 'none', color: 'var(--text)', fontFamily: 'inherit' }}
              />
              {excludeKeywords && (
                <button onClick={() => setExcludeKeywords('')} style={{ fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>✕</button>
              )}
            </div>

            {/* Count */}
            <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-4)' }}>
              {visibleListings.length.toLocaleString()} results
            </div>
          </div>

          {/* ── Listings header ───────────────────────────────────────────── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '24px 0 12px', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              All listings
              <span style={{ color: 'var(--text-4)', textTransform: 'none', letterSpacing: 0, fontWeight: 400, marginLeft: 8 }}>
                {visibleListings.length} results
              </span>
            </h2>
            {activeStatus?.storage && (
              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                {activeStatus.storage.inserted > 0 && <span style={{ color: '#1a6b3a' }}>+{activeStatus.storage.inserted} new</span>}
                {activeStatus.storage.updated > 0 && <span> · {activeStatus.storage.updated} updated</span>}
                {activeStatus.storage.priceChanged ? <span style={{ color: 'var(--accent)' }}> · {activeStatus.storage.priceChanged} price chg</span> : null}
                {activeStatus.scrapedAt && <span> · scraped {new Date(activeStatus.scrapedAt).toLocaleTimeString()}</span>}
              </div>
            )}
          </div>

          {/* ── Desktop table ─────────────────────────────────────────────── */}
          <div className="df-table-wrap" style={{ display: 'none' }} id="df-desktop-table">
            <table className="df-table">
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>Business</th>
                  <th>Source</th>
                  <th className="sortable" onClick={() => handleSort('location')}>
                    State {sortArrow('location')}
                  </th>
                  <th className="sortable" style={{ textAlign: 'right' }} onClick={() => handleSort('asking_price')}>
                    Asking {sortArrow('asking_price')}
                  </th>
                  <th className="sortable" style={{ textAlign: 'right' }} onClick={() => handleSort('annual_revenue')}>
                    Revenue {sortArrow('annual_revenue')}
                  </th>
                  <th className="sortable" style={{ textAlign: 'right' }} onClick={() => handleSort('cash_flow')}>
                    Cash Flow {sortArrow('cash_flow')}
                  </th>
                  <th className="sortable" style={{ textAlign: 'right' }} onClick={() => handleSort('first_seen_at')}>
                    Added {sortArrow('first_seen_at')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {storedLoading && stored.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>Loading…</td></tr>
                ) : sortedListings.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
                    {stored.length === 0 ? 'No listings yet — click a source above to scrape.' : 'No listings match your filters.'}
                  </td></tr>
                ) : sortedListings.map((l) => {
                  const hasPriceChange = !!l.price_changed_at
                  const dotColor = SOURCE_DOTS[l.source] || '#aaa'
                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          {hasPriceChange && (
                            <span className="df-pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', flexShrink: 0, marginTop: 1, padding: '2px 7px', fontSize: 9 }}>
                              Price ↓
                            </span>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <a
                              href={l.source_listing_url}
                              target="_blank" rel="noopener noreferrer"
                              onClick={(e) => handleListingClick(l, e)}
                              style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--text)', display: 'block', lineHeight: 1.45, cursor: 'pointer' }}
                              title={l.title}
                            >
                              {l.title}
                            </a>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className="df-source-dot"
                          style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500, '--dot-color': dotColor } as React.CSSProperties}
                        >
                          {l.source}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{l.location ?? '—'}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="df-num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                          {fmtMoneyCompact(l.asking_price)}
                        </div>
                        {hasPriceChange && l.previous_asking_price != null && (
                          <div className="df-num" style={{ fontSize: 11, color: 'var(--text-4)', textDecoration: 'line-through', marginTop: 2 }}>
                            {fmtMoneyCompact(l.previous_asking_price)}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="df-num" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                          {fmtMoneyFull(l.annual_revenue, l.annual_revenue_text)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="df-num" style={{ fontSize: 13, color: 'var(--money)', fontWeight: 600 }}>
                          {fmtMoneyFull(l.cash_flow, l.cash_flow_text)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="df-num" style={{ fontSize: 12, color: 'var(--text-4)' }}>
                          {new Date(l.first_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ──────────────────────────────────────────────── */}
          <div id="df-mobile-cards">
            {storedLoading && stored.length === 0 ? (
              <div className="df-card" style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-4)' }}>Loading…</div>
            ) : sortedListings.length === 0 ? (
              <div className="df-card" style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-4)' }}>
                {stored.length === 0 ? 'No listings yet — tap a source to scrape.' : 'No listings match your filters.'}
              </div>
            ) : sortedListings.map((l) => {
              const hasPriceChange = !!l.price_changed_at
              const dotColor = SOURCE_DOTS[l.source] || '#aaa'
              return (
                <div key={l.id} className="df-card" style={{ padding: 16, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                        {hasPriceChange && (
                          <span className="df-pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 9 }}>Price ↓</span>
                        )}
                        <span
                          className="df-source-dot"
                          style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500, '--dot-color': dotColor } as React.CSSProperties}
                        >
                          {l.source}
                        </span>
                      </div>
                      <a
                        href={l.source_listing_url}
                        target="_blank" rel="noopener noreferrer"
                        onClick={(e) => handleListingClick(l, e)}
                        style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4, display: 'block', cursor: 'pointer' }}
                      >
                        {l.title}
                      </a>
                      {l.location && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{l.location}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', marginTop: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      Asking <span className="df-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{fmtMoneyCompact(l.asking_price)}</span>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      Revenue <span className="df-num" style={{ color: 'var(--text-2)' }}>{fmtMoneyFull(l.annual_revenue, l.annual_revenue_text)}</span>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      Cash flow <span className="df-num" style={{ fontWeight: 600, color: 'var(--money)' }}>{fmtMoneyFull(l.cash_flow, l.cash_flow_text)}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Responsive: swap table/cards via media query */}
          <style>{`
            @media (min-width: 860px) {
              #df-desktop-table { display: block !important; }
              #df-mobile-cards  { display: none !important; }
            }
          `}</style>

          {/* ── Recent activity ───────────────────────────────────────────── */}
          {activity.length > 0 && (
            <>
              <h2 style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '44px 0 12px' }}>
                Recent activity
              </h2>
              <div className="df-card" style={{ padding: 6 }}>
                {activity.map((e, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
                    borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none',
                    flexWrap: 'wrap',
                  }}>
                    <span className="df-pill" style={{
                      background: e.kind === 'sold' ? '#fef3c7' : e.kind === 'delisted' ? '#fef2f2' : '#eef1fe',
                      color: e.kind === 'sold' ? 'var(--warn)' : e.kind === 'delisted' ? 'var(--danger)' : 'var(--accent)',
                      flexShrink: 0,
                    }}>
                      {e.kind}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {e.listing.title}
                    </span>
                    {e.kind === 'price' && e.listing.previous_asking_price != null && e.listing.asking_price != null && (
                      <span className="df-num" style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                        {fmtMoneyCompact(e.listing.previous_asking_price)}
                        <span style={{ color: 'var(--text-4)', margin: '0 4px' }}>→</span>
                        <span style={{ color: 'var(--accent)' }}>{fmtMoneyCompact(e.listing.asking_price)}</span>
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-4)', flexShrink: 0, minWidth: 60, textAlign: 'right' }}>
                      {new Date(e.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>

        {/* ── Hard-lock paywall: floating card over blurred page (no dark backdrop) ── */}
        {entitlement?.shouldPaywall && !entitlement?.isSubscribed && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20, pointerEvents: 'none',
          }}>
            <div style={{
              background: '#ffffff', borderRadius: 18,
              boxShadow: '0 8px 40px -8px rgba(26,26,46,0.18), 0 2px 8px 0 rgba(26,26,46,0.08)',
              padding: '32px 32px 28px', maxWidth: 420, width: '100%', boxSizing: 'border-box',
              border: '1px solid #e8e6e1', pointerEvents: 'all',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                  background: '#eef1fe', color: '#4f6ef7',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                }}>🔒</div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1a2e', lineHeight: 1.2 }}>
                    Unlock Deal Flow
                  </div>
                  <div style={{ fontSize: 12, color: '#7a7a9a', marginTop: 2 }}>
                    You&apos;ve used your 3 free previews
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: '#4a4a6a', lineHeight: 1.6, margin: '0 0 20px' }}>
                Subscribe for <strong style={{ color: '#1a1a2e' }}>$19/month</strong> to get unlimited
                listing access, daily refreshes, and price-change alerts.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {['Unlimited listing clicks', 'Daily broker refresh', 'Price-change alerts', 'AI-powered search'].map((f) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: '#4a4a6a' }}>
                    <span style={{
                      width: 17, height: 17, borderRadius: 999, flexShrink: 0,
                      background: '#eef1fe', color: '#4f6ef7',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    {f}
                  </div>
                ))}
              </div>

              <Link
                href={entitlement?.isAuthed ? '/pricing' : '/auth/sign-up?next=/pricing'}
                style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  background: '#4f6ef7', color: 'white',
                  borderRadius: 10, padding: '12px 16px', fontSize: 14, fontWeight: 600,
                  letterSpacing: '-0.01em',
                  boxShadow: '0 1px 3px 0 rgba(79,110,247,0.25), 0 4px 12px -4px rgba(79,110,247,0.3)',
                }}
              >
                {entitlement?.isAuthed ? 'Subscribe — $19 / month' : 'Sign up & subscribe'}
              </Link>
              {!entitlement?.isAuthed && (
                <p style={{ fontSize: 12, color: '#7a7a9a', textAlign: 'center', marginTop: 10, marginBottom: 0 }}>
                  Already have an account?{' '}
                  <Link href="/auth/sign-in?next=/pricing" style={{ color: '#4f6ef7', textDecoration: 'none', fontWeight: 500 }}>
                    Sign in
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Mid-session paywall modal (triggered after 3rd click, dismissable) ── */}
        {paywallOpen && !entitlement?.shouldPaywall && (
          <div
            onClick={() => setPaywallOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 50,
              background: 'rgba(26,26,46,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20, backdropFilter: 'blur(4px)',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#ffffff', borderRadius: 16,
                boxShadow: '0 20px 60px -10px rgba(26,26,46,0.3)',
                padding: 32, maxWidth: 440, width: '100%', boxSizing: 'border-box',
                border: '1px solid #e8e6e1',
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12, marginBottom: 18,
                background: '#eef1fe', color: '#4f6ef7',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
              }}>✦</div>
              <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, color: '#1a1a2e' }}>
                You&apos;ve used your free previews
              </h2>
              <p style={{ fontSize: 13, color: '#7a7a9a', marginTop: 8, lineHeight: 1.55 }}>
                Subscribe for <strong style={{ color: '#1a1a2e' }}>$19/month</strong> to unlock unlimited
                listing access, daily refreshes, and price-change alerts. Cancel anytime.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {['Unlimited listings', 'Daily broker refresh', 'Price-change alerts', 'AI search'].map((f) => (
                  <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#4a4a6a' }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: 999, flexShrink: 0,
                      background: '#eef1fe', color: '#4f6ef7',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={entitlement?.isAuthed ? '/pricing' : '/auth/sign-up?next=/pricing'}
                style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  background: '#4f6ef7', color: 'white',
                  borderRadius: 10, padding: '12px 16px', fontSize: 14, fontWeight: 500,
                }}
              >
                {entitlement?.isAuthed ? 'Subscribe — $19 / month' : 'Sign up & subscribe'}
              </Link>
              {!entitlement?.isAuthed && (
                <p style={{ fontSize: 12, color: '#7a7a9a', textAlign: 'center', marginTop: 12 }}>
                  Already have an account?{' '}
                  <Link href="/auth/sign-in?next=/pricing" style={{ color: '#4f6ef7', textDecoration: 'none', fontWeight: 500 }}>
                    Sign in
                  </Link>
                </p>
              )}
              <button
                onClick={() => setPaywallOpen(false)}
                style={{
                  width: '100%', marginTop: 8, padding: '10px',
                  background: 'transparent', border: 'none',
                  color: '#a8a8c0', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Maybe later
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
