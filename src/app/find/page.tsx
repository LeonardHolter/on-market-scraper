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

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-6 sm:px-6 sm:py-10">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Find Listings</h1>
            <p className="text-sm text-gray-500 mt-1">
              Describe your perfect acquisition. AI surfaces the top 10 matches.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 text-xs text-gray-500 hover:text-blue-400 underline-offset-2 hover:underline mt-1"
          >
            ← Back
          </Link>
        </div>

        {/* Search box */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSearch()
            }}
            placeholder="e.g. Profitable B2B SaaS with $1–3M cash flow, recurring revenue, low customer concentration. Or: Light-industrial service business in Texas or Florida, $500K–$1M SDE."
            rows={4}
            className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-600 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-gray-600">
              {query.length}/4000 · ⌘/Ctrl+Enter to search
            </span>
            <button
              onClick={runSearch}
              disabled={loading || !query.trim()}
              className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors whitespace-nowrap"
            >
              {loading ? 'Thinking…' : 'Find matches'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-950/40 border border-red-900 rounded-xl p-4 text-sm text-red-300">
            <strong className="font-semibold">Error: </strong>{error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-gray-500">
            Searching across stored listings…
          </div>
        )}

        {/* Results */}
        {!loading && results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h2 className="text-base sm:text-lg font-semibold text-white">
                Top {results.length} match{results.length === 1 ? '' : 'es'}
              </h2>
              <span className="text-[11px] text-gray-500">
                Considered {totalConsidered.toLocaleString()} listings
              </span>
            </div>

            {results.map((r) => (
              <a
                key={r.id}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-blue-700 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600/20 border border-blue-700 text-blue-300 text-xs font-semibold flex items-center justify-center">
                    {r.rank}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white leading-snug">
                        {r.title}
                      </h3>
                      <span className="text-[10px] text-gray-600 uppercase tracking-wider shrink-0 mt-0.5">
                        {r.source}
                      </span>
                    </div>
                    {r.location && (
                      <p className="text-[11px] text-gray-600 mt-0.5">{r.location}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed">{r.reason}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] tabular-nums">
                      <span className="text-gray-500">
                        Asking <span className="text-green-400 font-medium">{fmtMoney(r.asking_price)}</span>
                      </span>
                      <span className="text-gray-500">
                        Revenue <span className="text-gray-300">{fmtMoney(r.annual_revenue)}</span>
                      </span>
                      <span className="text-gray-500">
                        Cash flow <span className="text-gray-300">{fmtMoney(r.cash_flow)}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && results.length === 0 && totalConsidered === 0 && query.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-gray-500">
            Describe what you&apos;re looking for above to get started.
          </div>
        )}

      </div>
    </div>
  )
}
