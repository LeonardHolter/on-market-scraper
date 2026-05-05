import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ListingForAI {
  id: string
  source: string
  title: string
  url: string
  asking_price: number | null
  annual_revenue: number | null
  cash_flow: number | null
  location: string | null
}

interface AIResultItem {
  id: string
  rank: number
  reason: string
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'OPENAI_API_KEY is not configured.' },
      { status: 500 }
    )
  }

  let query = ''
  try {
    const body = await req.json()
    query = (body?.query || '').toString().trim()
  } catch {
    /* fall through */
  }
  if (!query) {
    return NextResponse.json(
      { success: false, error: 'Missing "query" in request body.' },
      { status: 400 }
    )
  }
  if (query.length > 4000) {
    return NextResponse.json(
      { success: false, error: 'Query is too long (max 4000 chars).' },
      { status: 400 }
    )
  }

  // Pull every plausible listing — same filters the dashboard applies.
  // Cash flow must be present, not sold, not delisted, no franchise in title.
  const { data, error } = await supabaseAdmin
    .from('broker_listings')
    .select(
      'id,source,source_listing_url,title,asking_price,annual_revenue,cash_flow,location,is_sold,delisted_at'
    )
    .not('cash_flow', 'is', null)
    .gte('cash_flow', 1)
    .neq('is_sold', true)
    .is('delisted_at', null)
    .limit(5000)

  if (error) {
    console.error('[find-listings] supabase error', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const listings: ListingForAI[] = (data || [])
    .filter((l) => !/\bfranchise[sd]?\b/i.test(l.title))
    .map((l) => ({
      id: l.id,
      source: l.source,
      title: l.title,
      url: l.source_listing_url,
      asking_price: l.asking_price,
      annual_revenue: l.annual_revenue,
      cash_flow: l.cash_flow,
      location: l.location,
    }))

  if (listings.length === 0) {
    return NextResponse.json({
      success: true,
      query,
      results: [],
      totalConsidered: 0,
    })
  }

  // Build a compact context block — keep tokens manageable.
  // Each row ≈ 100 chars → 5,000 listings ≈ 500 KB ≈ 125K tokens. We use the
  // listing arrays directly as JSON; gpt-4o-mini handles 128K context.
  const compact = listings.map((l) => ({
    id: l.id,
    src: l.source,
    title: l.title,
    price: l.asking_price,
    rev: l.annual_revenue,
    cf: l.cash_flow,
    loc: l.location,
  }))

  const openai = new OpenAI({ apiKey })

  const systemPrompt = `You are an expert M&A search assistant for a private buyer. The user describes their ideal acquisition. You will be given a JSON array of available business listings. Your job: pick the TOP 10 listings that best match the buyer's description, ranked from #1 (best fit) to #10. Match on industry, business model, financial profile (price / revenue / cash flow), and location when relevant. Be strict — only include listings that genuinely fit the buyer's intent. If fewer than 10 are a strong fit, return only the strong matches. Each result must include the exact listing id from the input and a 1–2 sentence "reason" explaining why it fits.`

  const userPrompt = `Buyer's description of their perfect listing:
"""
${query}
"""

Available listings (JSON, ${compact.length} total):
${JSON.stringify(compact)}

Return the top 10 best matches.`

  let aiResults: AIResultItem[] = []
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'listing_matches',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string' },
                    rank: { type: 'integer' },
                    reason: { type: 'string' },
                  },
                  required: ['id', 'rank', 'reason'],
                },
              },
            },
            required: ['results'],
          },
        },
      },
    })

    const content = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(content)
    aiResults = Array.isArray(parsed.results) ? parsed.results : []
  } catch (e) {
    console.error('[find-listings] OpenAI error', e)
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'AI request failed',
      },
      { status: 502 }
    )
  }

  // Hydrate the AI's id picks with full listing data, in rank order
  const byId = new Map(listings.map((l) => [l.id, l]))
  const enriched = aiResults
    .filter((r) => byId.has(r.id))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
    .map((r) => ({
      ...byId.get(r.id)!,
      rank: r.rank,
      reason: r.reason,
    }))

  return NextResponse.json({
    success: true,
    query,
    totalConsidered: listings.length,
    results: enriched,
  })
}
