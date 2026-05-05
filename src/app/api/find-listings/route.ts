import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'ANTHROPIC_API_KEY is not configured.' },
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

  // Pull every plausible listing — same baseline filters as the dashboard.
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

  // Compact context block. Same listing set across queries within a day → cached.
  const compact = listings.map((l) => ({
    id: l.id,
    src: l.source,
    title: l.title,
    price: l.asking_price,
    rev: l.annual_revenue,
    cf: l.cash_flow,
    loc: l.location,
  }))

  const systemPrompt = `You are an expert M&A search assistant for a private buyer. The user describes their ideal acquisition. You receive a JSON array of available business listings. Pick the TOP 10 listings that best match the buyer's description, ranked from #1 (best fit) to #10. Match on industry, business model, financial profile (price / revenue / cash flow), and location when relevant. Be strict — only include listings that genuinely fit the buyer's intent. If fewer than 10 are strong fits, return only the strong matches. Each result must include the exact listing id from the input and a 1-2 sentence reason explaining the fit.`

  const listingsBlock = `Available listings (JSON, ${compact.length} total):\n${JSON.stringify(compact)}`
  const queryBlock = `Buyer's description of their perfect listing:\n"""\n${query}\n"""\n\nReturn the top 10 best matches via the return_matches tool.`

  const anthropic = new Anthropic({ apiKey })

  let aiResults: AIResultItem[] = []
  let usage: Anthropic.Messages.Usage | null = null
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      tools: [
        {
          name: 'return_matches',
          description: 'Return the top 10 best-matched listings, ranked.',
          input_schema: {
            type: 'object' as const,
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Exact listing id from the input.' },
                    rank: { type: 'integer', description: '1 = best fit, 10 = tenth-best.' },
                    reason: { type: 'string', description: '1-2 sentences explaining the fit.' },
                  },
                  required: ['id', 'rank', 'reason'],
                },
              },
            },
            required: ['results'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'return_matches' },
      messages: [
        {
          role: 'user',
          content: [
            // Cache the listings block — it changes once a day after the cron, but
            // is identical across multiple buyer queries in between scrapes.
            { type: 'text', text: listingsBlock, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: queryBlock },
          ],
        },
      ],
    })

    const toolUse = response.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Claude did not return a tool_use block')
    }
    const input = toolUse.input as { results?: AIResultItem[] }
    aiResults = Array.isArray(input.results) ? input.results : []
    usage = response.usage ?? null
  } catch (e) {
    console.error('[find-listings] Claude error', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'AI request failed' },
      { status: 502 }
    )
  }

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
    usage,
  })
}
