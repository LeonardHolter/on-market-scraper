import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Hits all source scrapers sequentially. Wired up to Vercel Cron via vercel.json.
 * Sources that need browser interaction (Bateson login / Cloudflare) will fail
 * silently here and need to be triggered manually from the dashboard the first
 * time, until session cookies are warm.
 */
const SOURCES = [
  { name: 'synergy', endpoint: '/api/scrape/synergy', method: 'POST' as const },
  // Bateson disabled by default in cron because it requires a browser window.
  // Re-enable once cookies are persisted and headless succeeds.
  // { name: 'bateson', endpoint: '/api/scrape/bateson', method: 'POST' },
]

export async function GET(req: NextRequest) {
  return runAll(req)
}
export async function POST(req: NextRequest) {
  return runAll(req)
}

async function runAll(req: NextRequest) {
  // Optional: verify Vercel cron secret
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const origin = req.nextUrl.origin
  const results: Record<string, unknown> = {}

  for (const src of SOURCES) {
    const start = Date.now()
    try {
      const res = await fetch(`${origin}${src.endpoint}`, { method: src.method })
      const data = await res.json().catch(() => ({}))
      results[src.name] = {
        ok: res.ok && data?.success,
        durationMs: Date.now() - start,
        count: data?.count,
        storage: data?.storage,
        error: data?.error || null,
      }
    } catch (e) {
      results[src.name] = {
        ok: false,
        durationMs: Date.now() - start,
        error: e instanceof Error ? e.message : 'unknown',
      }
    }
  }

  return NextResponse.json({
    success: true,
    ranAt: new Date().toISOString(),
    results,
  })
}
