import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source')
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 500

  let query = supabaseAdmin
    .from('broker_listings')
    .select(
      'id,source,source_listing_url,title,asking_price_text,asking_price,annual_revenue_text,annual_revenue,cash_flow_text,cash_flow,location,status,first_seen_at,last_seen_at,is_sold,sold_detected_at,previous_asking_price,price_changed_at,previous_title,title_changed_at,delisted_at,is_hidden'
    )
    .order('asking_price', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (source) query = query.eq('source', source)

  const { data, error } = await query

  if (error) {
    console.error('[broker-listings GET] error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  // Per-source counts
  const { data: counts } = await supabaseAdmin
    .from('broker_listings')
    .select('source')

  const bySource: Record<string, number> = {}
  ;(counts || []).forEach((r) => {
    bySource[r.source] = (bySource[r.source] || 0) + 1
  })

  return NextResponse.json({
    success: true,
    total: data?.length || 0,
    bySource,
    listings: data || [],
  })
}
