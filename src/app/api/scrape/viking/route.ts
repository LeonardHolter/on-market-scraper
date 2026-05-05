import { NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Viking Mergers & Acquisitions — server-rendered Elementor/JetEngine site.
 *
 * All ~90 listings are on one page. Each card is a:
 *   <div class="jet-listing-grid__item jet-listing-dynamic-post-XXXXX">
 *
 * Inside each card:
 *   - data-url on `.jet-engine-listing-overlay-wrap` → listing URL
 *   - First `.elementor-heading-title` → listing title
 *   - Subsequent `.elementor-heading-title` → field labels (Price:, Revenues:,
 *     Cash Flow: or EBITDA:, Location:)
 *   - `.jet-listing-dynamic-field__content` → field values (in same order as labels)
 *
 * Price can be a dollar amount or "Market Price" (undisclosed).
 * Cash flow may be labelled "Cash Flow:" or "EBITDA:" — we use whichever is present.
 */

const SEARCH_URL = 'https://www.vikingmergers.com/businesses-for-sale/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface VikingListing {
  title: string
  url: string
  askingPrice: string
  revenue: string
  cashFlow: string
  location: string
}

function cleanText(v: string): string {
  return v.replace(/&amp;/g, '&').replace(/&#038;/g, '&').trim().replace(/\s+/g, ' ')
}

function parseListings(html: string): VikingListing[] {
  const $ = cheerio.load(html)
  const out: VikingListing[] = []

  $('.jet-listing-grid__item').each((_, el) => {
    const $card = $(el)

    // URL from the overlay wrapper
    const url = $card.find('.jet-engine-listing-overlay-wrap').first().attr('data-url') ?? ''

    // All heading titles in order: [title, 'Price:', 'Revenues:', 'Cash Flow:'/'EBITDA:', 'Location:']
    const headings = $card
      .find('.elementor-heading-title')
      .map((_, h) => cleanText($(h).text()))
      .get()

    // All dynamic field values in order: [category, priceVal, revenueVal, cfVal, locationVal]
    const values = $card
      .find('.jet-listing-dynamic-field__content')
      .map((_, v) => cleanText($(v).text()))
      .get()

    if (!headings.length || !url) return

    const title = headings[0]
    if (!title) return

    // Build a label→value map from the remaining headings (skip index 0 = title)
    // Values[0] is the category (not preceded by a heading label), values[1..] align with headings[1..]
    const fields: Record<string, string> = {}
    for (let i = 1; i < headings.length; i++) {
      const label = headings[i].replace(/:$/, '').toUpperCase()
      const val = values[i] ?? ''   // values[0] = category, values[i] aligns with headings[i]
      if (label && val) fields[label] = val
    }

    const askingPrice = fields['PRICE'] ?? ''
    const revenue = fields['REVENUES'] ?? ''
    const cashFlow = fields['CASH FLOW'] || fields['EBITDA'] || ''
    const location = fields['LOCATION'] ?? ''

    out.push({ title, url, askingPrice, revenue, cashFlow, location })
  })

  return out
}

export async function POST() {
  try {
    const res = await axios.get<string>(SEARCH_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        Referer: 'https://www.google.com/',
      },
      timeout: 60_000,
      maxContentLength: 30 * 1024 * 1024,
      maxBodyLength: 30 * 1024 * 1024,
      validateStatus: () => true, // capture non-2xx so we can diagnose
    })

    const html = res.data
    const status = res.status
    const ctype = res.headers['content-type'] ?? ''

    if (status !== 200) {
      console.error('[viking] non-200 response', { status, ctype, snippet: String(html).slice(0, 400) })
      return NextResponse.json(
        { success: false, error: `Viking returned HTTP ${status}`, snippet: String(html).slice(0, 400) },
        { status: 502 }
      )
    }

    const all = parseListings(html)

    // Deduplicate by URL
    const seen = new Set<string>()
    const unique = all.filter((l) => {
      const key = l.url || `viking:${l.title}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (unique.length === 0) {
      // Return diagnostic info — most likely Cloudflare/WAF returned a challenge page
      const looksLikeChallenge = /cloudflare|captcha|attention required|just a moment|challenge/i.test(html.slice(0, 5000))
      console.error('[viking] zero listings parsed', {
        status, ctype, looksLikeChallenge, length: html.length, snippet: html.slice(0, 600),
      })
      return NextResponse.json(
        {
          success: false,
          error: looksLikeChallenge
            ? 'Viking blocked the request (Cloudflare/WAF challenge page).'
            : 'No listings parsed — site layout may have changed.',
          looksLikeChallenge,
          htmlLength: html.length,
          snippet: html.slice(0, 600),
        },
        { status: 404 }
      )
    }

    const upsert = await upsertBrokerListings(
      unique.map((l) => ({
        source: 'viking',
        source_listing_url: l.url,
        title: l.title,
        // "Market Price" = undisclosed; store empty so parsePrice yields null
        asking_price_text: l.askingPrice === 'Market Price' ? '' : l.askingPrice,
        annual_revenue_text: l.revenue,
        cash_flow_text: l.cashFlow,
        location: l.location,
        raw_data: l,
      })),
      { markDelisted: true }
    )

    return NextResponse.json({
      success: true,
      count: unique.length,
      storage: upsert,
      scrapedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Viking scrape error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
