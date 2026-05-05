import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

const FULL_SELECT =
  'id,source,source_listing_url,title,asking_price_text,asking_price,annual_revenue_text,annual_revenue,cash_flow_text,cash_flow,location,status,first_seen_at,last_seen_at,is_sold,sold_detected_at,previous_asking_price,price_changed_at,previous_title,title_changed_at,delisted_at,is_hidden'

// Fallback select without is_hidden — used if the migration hasn't been applied yet
const FALLBACK_SELECT =
  'id,source,source_listing_url,title,asking_price_text,asking_price,annual_revenue_text,annual_revenue,cash_flow_text,cash_flow,location,status,first_seen_at,last_seen_at,is_sold,sold_detected_at,previous_asking_price,price_changed_at,previous_title,title_changed_at,delisted_at'

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source')
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 5000

  const buildQuery = (selectCols: string) => {
    let q = supabaseAdmin
      .from('broker_listings')
      .select(selectCols)
      .order('asking_price', { ascending: false, nullsFirst: false })
      .limit(limit)
    if (source) q = q.eq('source', source)
    return q
  }

  let { data, error } = await buildQuery(FULL_SELECT)

  // If the is_hidden column hasn't been added yet, retry without it
  if (error && /is_hidden/i.test(error.message || '')) {
    console.warn('[broker-listings GET] is_hidden column missing — falling back. Run database-schema-hidden.sql.')
    const retry = await buildQuery(FALLBACK_SELECT)
    data = retry.data
    error = retry.error
  }

  if (error) {
    console.error('[broker-listings GET] error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  // Per-source counts. Use a HEAD count per known source so we never get cut
  // off by Supabase's default 1000-row limit on regular SELECTs.
  const knownSources = ['synergy', 'bateson', 'businessesforsale']
  const bySource: Record<string, number> = {}
  await Promise.all(
    knownSources.map(async (src) => {
      const { count } = await supabaseAdmin
        .from('broker_listings')
        .select('*', { count: 'exact', head: true })
        .eq('source', src)
      bySource[src] = count || 0
    })
  )

  return NextResponse.json({
    success: true,
    total: data?.length || 0,
    bySource,
    listings: data || [],
  })
}
