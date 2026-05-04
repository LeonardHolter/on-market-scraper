'use client'

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
  { name: 'Synergy Business Brokers',   source: 'synergy',          phase: 1, url: 'synergybb.com',                  endpoint: '/api/scrape/synergy' },
  { name: 'Bateson Business Brokerage', source: 'bateson',          phase: 1, url: 'breareger.dealrelations.com',    endpoint: '/api/scrape/bateson' },
  { name: 'BusinessesForSale.com',      source: 'businessesforsale',phase: 1, url: 'us.businessesforsale.com',       endpoint: '/api/scrape/businessesforsale' },
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
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [stored, setStored] = useState<StoredListing[]>([])
  const [bySource, setBySource] = useState<Record<string, number>>({})
  const [storedLoading, setStoredLoading] = useState(true)
  const [storedError, setStoredError] = useState<string | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<Record<string, ScrapeStatus>>({})
  const [lastAutoRun, setLastAutoRun] = useState<string | null>(null)
  const [hidingId, setHidingId] = useState<string | null>(null)
  const [minCashFlow, setMinCashFlow] = useState<number>(400_000)
  const [cashFlowInput, setCashFlowInput] = useState('400000')
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

  useEffect(() => {
    refreshStored(filterSource)
  }, [filterSource, refreshStored])

  const runScrape = useCallback(
    async (site: SiteConfig, opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setFilterSource(site.source)
      setScrapeStatus((s) => ({ ...s, [site.source]: { ...emptyStatus, loading: true } }))
      try {
        const res = await fetch(site.endpoint, { method: 'POST' })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
        setScrapeStatus((s) => ({
          ...s,
          [site.source]: {
            loading: false,
            error: null,
            storage: data.storage,
            scrapedAt: data.scrapedAt,
          },
        }))
      } catch (e) {
        setScrapeStatus((s) => ({
          ...s,
          [site.source]: {
            loading: false,
            error: e instanceof Error ? e.message : 'Scrape failed',
            storage: null,
            scrapedAt: null,
          },
        }))
      } finally {
        await refreshStored(filterSource)
      }
    },
    [filterSource, refreshStored]
  )

  const toggleHidden = useCallback(async (listing: StoredListing) => {
    const newVal = !listing.is_hidden
    setHidingId(listing.id)
    // Optimistic update
    setStored((prev) =>
      prev.map((l) => (l.id === listing.id ? { ...l, is_hidden: newVal } : l))
    )
    try {
      const res = await fetch(`/api/broker-listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: newVal }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      // Roll back on failure
      setStored((prev) =>
        prev.map((l) => (l.id === listing.id ? { ...l, is_hidden: !newVal } : l))
      )
    } finally {
      setHidingId(null)
    }
  }, [])

  // Client-side hourly auto-rescrape (works while dashboard is open, dev fallback)
  useEffect(() => {
    const tick = async () => {
      const now = Date.now()
      if (now - lastRunRef.current < HOUR_MS) return
      lastRunRef.current = now

      // Only run cron-safe sources here. Bateson needs a browser popup; skip it.
      const cronSafe = SITES.filter((s) => s.source === 'synergy' || s.source === 'businessesforsale')
      for (const site of cronSafe) {
        await runScrape(site, { silent: true })
      }
      setLastAutoRun(new Date().toISOString())
    }

    // Stagger first auto-run by 30s after page load so it doesn't fight the initial fetch
    const initial = setTimeout(() => {
      lastRunRef.current = Date.now() - HOUR_MS // force first tick to run
      tick()
    }, 30_000)
    const interval = setInterval(tick, 60_000) // check every minute, run if hour elapsed

    return () => {
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [runScrape])

  const totalStored = Object.values(bySource).reduce((a, b) => a + b, 0)
  const activeStatus = filterSource ? scrapeStatus[filterSource] : null
  const filteredByCashFlow = stored.filter((l) => {
    // Cash flow must always be present
    if (l.cash_flow == null) return false
    if (minCashFlow <= 0) return true
    return l.cash_flow >= minCashFlow
  })
  const visibleListings = filteredByCashFlow.filter((l) => {
    // Drop sold and delisted listings
    if (l.is_sold || l.delisted_at) return false
    // Drop franchise listings — we don't buy franchises
    if (/\bfranchise[sd]?\b/i.test(l.title)) return false
    // Cash flow is already guaranteed non-null by filteredByCashFlow above
    return true
  })

  const fmtMoney = (n: number | null, fallback: string | null) =>
    n != null ? `$${n.toLocaleString()}` : fallback || '—'

  // Activity feed: top 8 events (sold, price changes, delistings) in last 30 days
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
    <div className="min-h-screen bg-gray-950 px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-8">

        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Scraper</h1>
            <p className="text-sm text-gray-500 mt-1">
              On-market broker sources scraped hourly for deal flow.
              {lastAutoRun && (
                <span className="ml-2 text-gray-600">
                  · last auto-run {new Date(lastAutoRun).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white">{totalStored.toLocaleString()}</div>
            <div className="text-[11px] text-gray-500 uppercase tracking-wider">Total listings stored</div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {SITES.map((site) => {
            const status = scrapeStatus[site.source]
            const count = bySource[site.source] || 0
            const isFiltered = filterSource === site.source
            const isLoading = status?.loading
            const hasError = !!status?.error

            return (
              <button
                key={site.name}
                onClick={() => runScrape(site)}
                disabled={isLoading}
                className={`text-left bg-gray-900 border rounded-xl p-4 flex flex-col gap-3 transition-colors disabled:cursor-not-allowed ${
                  isFiltered
                    ? 'border-blue-600 ring-1 ring-blue-600/30'
                    : 'border-gray-800 hover:border-gray-600'
                }`}
              >
                <span className="text-[10px] font-medium text-gray-600 uppercase tracking-widest">
                  Phase {site.phase}
                </span>
                <p className="text-sm font-semibold text-white leading-snug">{site.name}</p>
                <p className="text-[11px] text-gray-600 truncate">{site.url}</p>
                <div className="mt-auto flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isLoading
                        ? 'bg-blue-500 animate-pulse'
                        : hasError
                        ? 'bg-red-500'
                        : count > 0
                        ? 'bg-green-500'
                        : 'bg-gray-700'
                    }`}
                  />
                  <span className="text-[11px] text-gray-500">
                    {isLoading
                      ? 'Scraping…'
                      : hasError
                      ? 'Failed'
                      : count > 0
                      ? `${count} stored`
                      : 'Click to scrape'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {activity.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-3">
              Recent activity
            </h3>
            <div className="space-y-2">
              {activity.map((e, i) => (
                <div key={i} className="flex items-start gap-3 text-xs">
                  <span
                    className={`mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium tracking-wider ${
                      e.kind === 'sold'
                        ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-800'
                        : e.kind === 'delisted'
                        ? 'bg-red-900/40 text-red-300 border border-red-900'
                        : 'bg-blue-900/40 text-blue-300 border border-blue-900'
                    }`}
                  >
                    {e.kind === 'sold' ? 'SOLD' : e.kind === 'delisted' ? 'DELISTED' : 'PRICE'}
                  </span>
                  <div className="flex-1 text-gray-300 truncate">
                    <span className="text-gray-500 mr-1">[{e.listing.source}]</span>
                    {e.listing.title}
                    {e.kind === 'price' &&
                      e.listing.previous_asking_price != null &&
                      e.listing.asking_price != null && (
                        <span className="ml-2 text-gray-500">
                          ${e.listing.previous_asking_price.toLocaleString()} →
                          <span className="text-blue-300 ml-1">
                            ${e.listing.asking_price.toLocaleString()}
                          </span>
                        </span>
                      )}
                  </div>
                  <span className="text-gray-600 whitespace-nowrap">
                    {new Date(e.ts).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="text-gray-500">Min cash flow:</span>
          <div className="flex items-center gap-1">
            <span className="text-gray-500">$</span>
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
              className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs focus:outline-none focus:border-blue-600"
            />
          </div>
          {minCashFlow > 0 && (
            <span className="text-gray-600">
              — showing {visibleListings.length} of {stored.length} listings
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-gray-500">Source:</span>
          <button
            onClick={() => setFilterSource(null)}
            className={`px-3 py-1 rounded-full border transition-colors ${
              filterSource === null
                ? 'border-blue-600 bg-blue-600/10 text-blue-300'
                : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'
            }`}
          >
            All ({totalStored})
          </button>
          {SITES.map((s) => (
            <button
              key={s.source}
              onClick={() => setFilterSource(s.source)}
              className={`px-3 py-1 rounded-full border transition-colors ${
                filterSource === s.source
                  ? 'border-blue-600 bg-blue-600/10 text-blue-300'
                  : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'
              }`}
            >
              {s.source} ({bySource[s.source] || 0})
            </button>
          ))}
        </div>

        {activeStatus?.error && (
          <div className="bg-red-950/40 border border-red-900 rounded-xl p-4 text-sm text-red-300">
            <strong className="font-semibold">Scrape error: </strong>
            {activeStatus.error}
          </div>
        )}

        {storedError && (
          <div className="bg-red-950/40 border border-red-900 rounded-xl p-4 text-sm text-red-300">
            <strong className="font-semibold">Database error: </strong>
            {storedError}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-white">
              {filterSource
                ? `${SITES.find((s) => s.source === filterSource)?.name ?? filterSource}`
                : 'All Listings'}{' '}
              <span className="text-gray-500 font-normal">({visibleListings.length})</span>
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-600">
              {activeStatus?.storage && (
                <span>
                  <span className="text-green-500">+{activeStatus.storage.inserted} new</span>
                  {activeStatus.storage.updated > 0 && (
                    <span className="text-gray-500"> · {activeStatus.storage.updated} updated</span>
                  )}
                  {activeStatus.storage.priceChanged ? (
                    <span className="text-blue-400"> · {activeStatus.storage.priceChanged} price</span>
                  ) : null}
                  {activeStatus.storage.newlySold ? (
                    <span className="text-yellow-400"> · {activeStatus.storage.newlySold} sold</span>
                  ) : null}
                  {activeStatus.storage.delisted ? (
                    <span className="text-red-400"> · {activeStatus.storage.delisted} delisted</span>
                  ) : null}
                  {activeStatus.storage.errors > 0 && (
                    <span className="text-red-500"> · {activeStatus.storage.errors} errors</span>
                  )}
                </span>
              )}
              {activeStatus?.scrapedAt && (
                <span>Scraped {new Date(activeStatus.scrapedAt).toLocaleString()}</span>
              )}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900/80 border-b border-gray-800 text-[10px] uppercase tracking-widest text-gray-500">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-right px-4 py-3 font-medium">Asking Price</th>
                  <th className="text-right px-4 py-3 font-medium">Annual Revenue</th>
                  <th className="text-right px-4 py-3 font-medium">Cash Flow</th>
                  <th className="text-right px-4 py-3 font-medium">First Seen</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {storedLoading && stored.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-600 text-xs">
                      Loading from Supabase…
                    </td>
                  </tr>
                ) : visibleListings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-600 text-xs">
                      {stored.length === 0
                        ? 'No listings stored yet — click a source above to scrape.'
                        : 'All listings marked as not interested.'}
                    </td>
                  </tr>
                ) : (
                  visibleListings.map((l) => {
                    const isSold = !!l.is_sold
                    const isDelisted = !!l.delisted_at
                    const isHidden = !!l.is_hidden
                    const hasPriceChange = !!l.price_changed_at
                    const titleColor = isHidden
                      ? 'text-gray-600 line-through'
                      : isDelisted
                      ? 'text-gray-500 line-through'
                      : isSold
                      ? 'text-yellow-200'
                      : 'text-white'

                    return (
                      <tr
                        key={l.id}
                        className={`border-b border-gray-800/60 last:border-b-0 transition-colors hover:bg-gray-800/20 ${
                          isHidden ? 'opacity-30' : ''
                        }`}
                      >
                        <td className="px-4 py-3 max-w-md">
                          <div className="flex items-start gap-2">
                            <div className="flex flex-col gap-1 mt-0.5 shrink-0">
                              {isSold && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium tracking-wider bg-yellow-900/50 text-yellow-300 border border-yellow-800">
                                  SOLD
                                </span>
                              )}
                              {isDelisted && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium tracking-wider bg-red-900/40 text-red-300 border border-red-900">
                                  DELISTED
                                </span>
                              )}
                              {hasPriceChange && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium tracking-wider bg-blue-900/40 text-blue-300 border border-blue-900">
                                  PRICE Δ
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              {l.source_listing_url ? (
                                <a
                                  href={l.source_listing_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`hover:text-blue-400 line-clamp-2 ${titleColor}`}
                                  title={l.title}
                                >
                                  {l.title}
                                </a>
                              ) : (
                                <span className={`line-clamp-2 ${titleColor}`}>{l.title}</span>
                              )}
                              {(l.location || l.status) && (
                                <div className="text-[11px] text-gray-600 mt-0.5">
                                  {l.status && <span className="mr-2">{l.status}</span>}
                                  {l.location}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 capitalize text-xs">{l.source}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          <div className={isDelisted ? 'text-gray-500' : 'text-green-400 font-medium'}>
                            {fmtMoney(l.asking_price, l.asking_price_text)}
                          </div>
                          {hasPriceChange && l.previous_asking_price != null && (
                            <div className="text-[10px] text-gray-600 line-through">
                              ${l.previous_asking_price.toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300 tabular-nums whitespace-nowrap">
                          {fmtMoney(l.annual_revenue, l.annual_revenue_text)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300 tabular-nums whitespace-nowrap">
                          {fmtMoney(l.cash_flow, l.cash_flow_text)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 text-xs whitespace-nowrap">
                          {new Date(l.first_seen_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => toggleHidden(l)}
                            disabled={hidingId === l.id}
                            title={isHidden ? 'Mark as interesting' : 'Not interested'}
                            className={`text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-40 ${
                              isHidden
                                ? 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                                : 'border-gray-800 text-gray-600 hover:border-red-800 hover:text-red-400 hover:bg-red-950/20'
                            }`}
                          >
                            {isHidden ? '↩ Restore' : '✕'}
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
