'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [hidingId, setHidingId] = useState<string | null>(null)
  const [minCashFlow, setMinCashFlow] = useState<number>(400_000)
  const [cashFlowInput, setCashFlowInput] = useState('400000')
  const [maxAskingPrice, setMaxAskingPrice] = useState<number>(10_000_000)
  const [maxPriceInput, setMaxPriceInput] = useState('10000000')
  const [hideFranchises, setHideFranchises] = useState(true)
  const [excludeKeywords, setExcludeKeywords] = useState<string>('')
  const [now, setNow] = useState<number>(() => Date.now())
  const lastRunRef = useRef<number>(0)

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
    async (site: SiteConfig, opts: { silent?: boolean } = {}) => {
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

  const toggleHidden = useCallback(async (listing: StoredListing) => {
    const newVal = !listing.is_hidden
    setHidingId(listing.id)
    setStored((prev) => prev.map((l) => (l.id === listing.id ? { ...l, is_hidden: newVal } : l)))
    try {
      const res = await fetch(`/api/broker-listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: newVal }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      setStored((prev) => prev.map((l) => (l.id === listing.id ? { ...l, is_hidden: !newVal } : l)))
    } finally {
      setHidingId(null)
    }
  }, [])

  useEffect(() => {
    const tick = async () => {
      const now = Date.now()
      if (now - lastRunRef.current < HOUR_MS) return
      lastRunRef.current = now
      const cronSafe = SITES.filter(
        (s) => s.source === 'synergy' || s.source === 'fcbb' || s.source === 'zoom'
      )
      for (const site of cronSafe) await runScrape(site, { silent: true })
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
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
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

  const filteredByCashFlow = stored.filter((l) => {
    if (!enabledSources.has(l.source)) return false
    if (l.cash_flow == null) return false
    if (minCashFlow <= 0) return true
    return l.cash_flow >= minCashFlow
  })

  const excludedKeywordList = excludeKeywords.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

  const visibleListings = filteredByCashFlow.filter((l) => {
    if (l.is_sold || l.delisted_at) return false
    if (hideFranchises && /\bfranchise[sd]?\b/i.test(l.title)) return false
    if (maxAskingPrice > 0 && l.asking_price != null && l.asking_price > maxAskingPrice) return false
    if (excludedKeywordList.length > 0) {
      const titleLower = l.title.toLowerCase()
      if (excludedKeywordList.some((kw) => titleLower.includes(kw))) return false
    }
    return true
  })

  const fmtMoney = (n: number | null, fallback: string | null) =>
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
    .slice(0, 8)

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 sm:px-6 sm:py-10">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">

        {/* ── Header ── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-white tracking-tight">Deal Flow</h1>
              <Link
                href="/find"
                className="text-xs px-3 py-1 rounded-full border border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
              >
                ✦ Find with AI
              </Link>
            </div>
            <p className="text-sm text-zinc-500 mt-1">
              Broker listings refreshed daily at 12:00 AM EST.
              {lastAutoRun && (
                <span className="ml-2 text-zinc-600">· last run {new Date(lastAutoRun).toLocaleTimeString()}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-left sm:text-right">
              <div className="text-xl sm:text-2xl font-semibold text-white tabular-nums tracking-tight">
                {fmtCountdown(msUntilRescrape)}
              </div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-widest mt-0.5">Next refresh</div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-xl sm:text-2xl font-semibold text-white tracking-tight">{totalStored.toLocaleString()}</div>
              <div className="text-[11px] text-zinc-500 uppercase tracking-widest mt-0.5">Stored</div>
            </div>
          </div>
        </div>

        {/* ── Source cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {SITES.map((site) => {
            const status = scrapeStatus[site.source]
            const count = bySource[site.source] || 0
            const isLoading = status?.loading
            const hasError = !!status?.error
            const isEnabled = enabledSources.has(site.source)
            return (
              <button
                key={site.name}
                onClick={() => runScrape(site)}
                disabled={isLoading}
                className={`text-left rounded-lg p-3 sm:p-4 flex flex-col gap-2 transition-all disabled:cursor-not-allowed border ${
                  !isEnabled
                    ? 'bg-zinc-900 border-zinc-800 opacity-40'
                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80'
                }`}
              >
                <p className="text-xs sm:text-sm font-medium text-white leading-snug">{site.name}</p>
                <p className="text-[11px] text-zinc-500 truncate hidden sm:block">{site.url}</p>
                <div className="mt-auto flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isLoading ? 'bg-blue-400 animate-pulse' : hasError ? 'bg-red-500' : count > 0 ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`} />
                  <span className="text-[11px] text-zinc-500">
                    {isLoading ? 'Scraping…' : hasError ? 'Error' : count > 0 ? `${count.toLocaleString()} listings` : 'Click to scrape'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Activity feed ── */}
        {activity.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-[11px] font-medium text-zinc-500 uppercase tracking-widest mb-3">Recent activity</h3>
            <div className="space-y-2">
              {activity.map((e, i) => (
                <div key={i} className="flex items-start gap-3 text-xs">
                  <span className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider uppercase ${
                    e.kind === 'sold'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : e.kind === 'delisted'
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  }`}>
                    {e.kind === 'sold' ? 'Sold' : e.kind === 'delisted' ? 'Delisted' : 'Price'}
                  </span>
                  <div className="flex-1 text-zinc-300 min-w-0 truncate">
                    <span className="text-zinc-600 mr-1">{e.listing.source}</span>
                    {e.listing.title}
                    {e.kind === 'price' && e.listing.previous_asking_price != null && e.listing.asking_price != null && (
                      <span className="ml-2 text-zinc-600">
                        ${e.listing.previous_asking_price.toLocaleString()} →
                        <span className="text-blue-400 ml-1">${e.listing.asking_price.toLocaleString()}</span>
                      </span>
                    )}
                  </div>
                  <span className="text-zinc-600 whitespace-nowrap">{new Date(e.ts).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Filters ── */}
        <div className="space-y-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center text-xs">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 shrink-0">Min cash flow</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-600">$</span>
                <input
                  type="number"
                  value={cashFlowInput}
                  onChange={(e) => {
                    setCashFlowInput(e.target.value)
                    const n = parseInt(e.target.value.replace(/,/g, ''), 10)
                    if (!isNaN(n)) setMinCashFlow(n)
                    else if (e.target.value === '') setMinCashFlow(0)
                  }}
                  placeholder="0"
                  className="w-28 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500 placeholder-zinc-700"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 shrink-0">Max asking price</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-600">$</span>
                <input
                  type="number"
                  value={maxPriceInput}
                  onChange={(e) => {
                    setMaxPriceInput(e.target.value)
                    const n = parseInt(e.target.value.replace(/,/g, ''), 10)
                    if (!isNaN(n)) setMaxAskingPrice(n)
                    else if (e.target.value === '') setMaxAskingPrice(0)
                  }}
                  placeholder="∞"
                  className="w-32 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500 placeholder-zinc-700"
                />
              </div>
            </div>
            <button
              onClick={() => setHideFranchises((v) => !v)}
              className={`self-start sm:self-auto px-3 py-1.5 rounded border text-xs transition-colors ${
                hideFranchises
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                  : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
              }`}
            >
              {hideFranchises ? '✓ ' : ''}Hide franchises
            </button>
            {(minCashFlow > 0 || maxAskingPrice > 0) && (
              <span className="text-zinc-600 text-[11px]">{visibleListings.length} of {stored.length} shown</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 shrink-0">Exclude keywords</span>
            <input
              type="text"
              value={excludeKeywords}
              onChange={(e) => setExcludeKeywords(e.target.value)}
              placeholder="e.g. laundromat, gas station, daycare"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500 placeholder-zinc-700"
            />
            {excludedKeywordList.length > 0 && (
              <span className="text-zinc-600 shrink-0">{excludedKeywordList.length} active</span>
            )}
            {excludeKeywords && (
              <button onClick={() => setExcludeKeywords('')} className="text-zinc-600 hover:text-zinc-400 px-1">✕</button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-zinc-500 shrink-0">Sources</span>
            {SITES.map((s) => {
              const isOn = enabledSources.has(s.source)
              return (
                <button
                  key={s.source}
                  onClick={() =>
                    setEnabledSources((prev) => {
                      const next = new Set(prev)
                      if (next.has(s.source)) next.delete(s.source)
                      else next.add(s.source)
                      return next
                    })
                  }
                  className={`px-2.5 py-1 rounded border transition-colors text-[11px] ${
                    isOn
                      ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                      : 'border-zinc-800 text-zinc-600 line-through hover:border-zinc-700 hover:text-zinc-500'
                  }`}
                >
                  {s.source} {isOn && <span className="text-zinc-600">({bySource[s.source] || 0})</span>}
                </button>
              )
            })}
            <span className="text-zinc-700">·</span>
            <button onClick={() => setEnabledSources(new Set(SITES.map((s) => s.source)))} className="text-zinc-600 hover:text-zinc-300 transition-colors">All</button>
            <button onClick={() => setEnabledSources(new Set())} className="text-zinc-600 hover:text-zinc-300 transition-colors">None</button>
          </div>
        </div>

        {/* ── Errors ── */}
        {activeStatus?.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            <strong className="font-medium">Scrape error: </strong>{activeStatus.error}
          </div>
        )}
        {storedError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            <strong className="font-medium">Database error: </strong>{storedError}
          </div>
        )}

        {/* ── Listings ── */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-widest">
              {enabledSources.size === SITES.length
                ? 'All listings'
                : enabledSources.size === 1
                ? SITES.find((s) => enabledSources.has(s.source))?.name ?? 'Listings'
                : `${enabledSources.size} sources`}
              <span className="ml-2 text-zinc-600 normal-case font-normal tracking-normal">{visibleListings.length} results</span>
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-zinc-600 flex-wrap">
              {activeStatus?.storage && (
                <span>
                  <span className="text-emerald-500">+{activeStatus.storage.inserted} new</span>
                  {activeStatus.storage.updated > 0 && <span> · {activeStatus.storage.updated} updated</span>}
                  {activeStatus.storage.priceChanged ? <span className="text-blue-400"> · {activeStatus.storage.priceChanged} price chg</span> : null}
                  {activeStatus.storage.newlySold ? <span className="text-amber-500"> · {activeStatus.storage.newlySold} sold</span> : null}
                  {activeStatus.storage.delisted ? <span className="text-red-400"> · {activeStatus.storage.delisted} delisted</span> : null}
                </span>
              )}
              {activeStatus?.scrapedAt && <span>Scraped {new Date(activeStatus.scrapedAt).toLocaleString()}</span>}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {storedLoading && stored.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-600 text-xs">Loading…</div>
            ) : visibleListings.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-600 text-xs">
                {stored.length === 0 ? 'No listings yet — tap a source to scrape.' : 'No listings match your filters.'}
              </div>
            ) : (
              visibleListings.map((l) => {
                const isSold = !!l.is_sold
                const isDelisted = !!l.delisted_at
                const isHidden = !!l.is_hidden
                const hasPriceChange = !!l.price_changed_at
                return (
                  <div key={l.id} className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${isHidden ? 'opacity-30' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                          {isSold && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">SOLD</span>}
                          {isDelisted && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">DELISTED</span>}
                          {hasPriceChange && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">PRICE Δ</span>}
                          <span className="text-[10px] text-zinc-600 capitalize">{l.source}</span>
                        </div>
                        {l.source_listing_url ? (
                          <a href={l.source_listing_url} target="_blank" rel="noopener noreferrer"
                            className={`text-sm font-medium leading-snug hover:text-blue-400 transition-colors ${isHidden ? 'text-zinc-600 line-through' : isDelisted ? 'text-zinc-500 line-through' : isSold ? 'text-amber-400' : 'text-white'}`}>
                            {l.title}
                          </a>
                        ) : (
                          <span className={`text-sm font-medium ${isHidden ? 'text-zinc-600 line-through' : 'text-white'}`}>{l.title}</span>
                        )}
                        {l.location && <p className="text-[11px] text-zinc-500 mt-0.5">{l.location}</p>}
                      </div>
                      <button
                        onClick={() => toggleHidden(l)}
                        disabled={hidingId === l.id}
                        className={`shrink-0 text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-40 ${
                          isHidden ? 'border-zinc-700 text-zinc-500 hover:text-zinc-300' : 'border-zinc-800 text-zinc-600 hover:border-red-500/30 hover:text-red-400'
                        }`}
                      >
                        {isHidden ? '↩' : '✕'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] tabular-nums">
                      <span className="text-zinc-500">Asking <span className={`font-medium ${isDelisted ? 'text-zinc-600' : 'text-emerald-400'}`}>{fmtMoney(l.asking_price, l.asking_price_text)}</span></span>
                      <span className="text-zinc-500">Revenue <span className="text-zinc-300">{fmtMoney(l.annual_revenue, l.annual_revenue_text)}</span></span>
                      <span className="text-zinc-500">Cash flow <span className="text-zinc-300">{fmtMoney(l.cash_flow, l.cash_flow_text)}</span></span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-900 border-b border-zinc-800 text-[10px] uppercase tracking-widest text-zinc-500">
                  <th className="text-left px-4 py-3 font-medium">Business</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-right px-4 py-3 font-medium">Asking</th>
                  <th className="text-right px-4 py-3 font-medium">Revenue</th>
                  <th className="text-right px-4 py-3 font-medium">Cash Flow</th>
                  <th className="text-right px-4 py-3 font-medium">Added</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="bg-zinc-950">
                {storedLoading && stored.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-600 text-xs">Loading…</td></tr>
                ) : visibleListings.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-600 text-xs">
                    {stored.length === 0 ? 'No listings yet — click a source above to scrape.' : 'No listings match your filters.'}
                  </td></tr>
                ) : (
                  visibleListings.map((l) => {
                    const isSold = !!l.is_sold
                    const isDelisted = !!l.delisted_at
                    const isHidden = !!l.is_hidden
                    const hasPriceChange = !!l.price_changed_at
                    const titleColor = isHidden ? 'text-zinc-600 line-through' : isDelisted ? 'text-zinc-500 line-through' : isSold ? 'text-amber-400' : 'text-white'
                    return (
                      <tr key={l.id} className={`border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-900 transition-colors ${isHidden ? 'opacity-30' : ''}`}>
                        <td className="px-4 py-3 max-w-md">
                          <div className="flex items-start gap-2">
                            <div className="flex flex-col gap-1 mt-0.5 shrink-0">
                              {isSold && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">SOLD</span>}
                              {isDelisted && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">DELISTED</span>}
                              {hasPriceChange && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">PRICE Δ</span>}
                            </div>
                            <div className="min-w-0">
                              {l.source_listing_url ? (
                                <a href={l.source_listing_url} target="_blank" rel="noopener noreferrer"
                                  className={`hover:text-blue-400 transition-colors line-clamp-2 ${titleColor}`} title={l.title}>
                                  {l.title}
                                </a>
                              ) : (
                                <span className={`line-clamp-2 ${titleColor}`}>{l.title}</span>
                              )}
                              {(l.location || l.status) && (
                                <div className="text-[11px] text-zinc-500 mt-0.5">
                                  {l.status && <span className="mr-2">{l.status}</span>}
                                  {l.location}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 capitalize text-xs">{l.source}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          <div className={isDelisted ? 'text-zinc-600' : 'text-emerald-400 font-medium'}>{fmtMoney(l.asking_price, l.asking_price_text)}</div>
                          {hasPriceChange && l.previous_asking_price != null && (
                            <div className="text-[10px] text-zinc-600 line-through">${l.previous_asking_price.toLocaleString()}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-300 tabular-nums whitespace-nowrap">{fmtMoney(l.annual_revenue, l.annual_revenue_text)}</td>
                        <td className="px-4 py-3 text-right text-zinc-300 tabular-nums whitespace-nowrap">{fmtMoney(l.cash_flow, l.cash_flow_text)}</td>
                        <td className="px-4 py-3 text-right text-zinc-600 text-xs whitespace-nowrap">{new Date(l.first_seen_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => toggleHidden(l)}
                            disabled={hidingId === l.id}
                            className={`text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-40 ${
                              isHidden
                                ? 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
                                : 'border-zinc-800 text-zinc-600 hover:border-red-500/30 hover:text-red-400'
                            }`}
                          >
                            {isHidden ? '↩' : '✕'}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
