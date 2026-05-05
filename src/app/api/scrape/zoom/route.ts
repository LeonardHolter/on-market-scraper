import { NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Zoom Business Brokers — server-rendered WordPress site (Visual Composer).
 *
 * All listings are on one page (~57 currently, no pagination). Each card is a
 * `<div class="vc_row platno ...">` containing:
 *   - <div class="title"> with the listing title (wrapped in an anchor to the detail page)
 *   - <div class="price"><span class="price-value">$X</span></div>
 *   - several <div class="description-name">LABEL: <span class="description-value|price-value">VALUE</span></div>
 *
 * Visible labels: LOCATION, LISTING ID, CASH FLOW, EBITDA.
 * Either CASH FLOW or EBITDA may be "N/A" — we pick the first non-N/A value
 * for cash_flow. Zoom doesn't expose annual revenue on the index page.
 */

const SEARCH_URL =
  'https://zoombusinessbrokers.com/businesses-for-sale/?wpv-wpcf-industry=&location=&price=&cash_flow=&featured=&established=&description=&sort_orderby=pipedrive_deal_value&sort_order=desc'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface ZoomListing {
  title: string
  url: string
  askingPrice: string
  cashFlow: string
  ebitda: string
  location: string
  listingId: string
}

function cleanValue(v: string): string {
  const s = v.trim().replace(/\s+/g, ' ')
  if (!s || /^n\/a$/i.test(s)) return ''
  return s
}

function parseListings(html: string): ZoomListing[] {
  const $ = cheerio.load(html)
  const out: ZoomListing[] = []

  $('div.vc_row.platno').each((_, el) => {
    const $card = $(el)
    const $titleEl = $card.find('.title').first()
    const title = $titleEl.text().trim().replace(/\s+/g, ' ')
    if (!title) return

    const url = $titleEl.closest('a').attr('href') || ''
    const askingPrice = cleanValue($card.find('.price .price-value').first().text())

    const fields: Record<string, string> = {}
    $card.find('.description-name').each((_, dn) => {
      const $dn = $(dn)
      const $val = $dn.find('.description-value, .price-value').first()
      const value = $val.text().trim().replace(/\s+/g, ' ')
      const $clone = $dn.clone()
      $clone.find('.description-value, .price-value').remove()
      const label = $clone
        .text()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/:$/, '')
        .toUpperCase()
      if (label) fields[label] = value
    })

    out.push({
      title,
      url,
      askingPrice,
      cashFlow: cleanValue(fields['CASH FLOW'] || ''),
      ebitda: cleanValue(fields['EBITDA'] || ''),
      location: cleanValue(fields['LOCATION'] || ''),
      listingId: cleanValue(fields['LISTING ID'] || ''),
    })
  })

  return out
}

export async function POST() {
  try {
    const { data: html } = await axios.get<string>(SEARCH_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 60_000,
      maxContentLength: 30 * 1024 * 1024,
      maxBodyLength: 30 * 1024 * 1024,
    })

    const all = parseListings(html)

    const seen = new Set<string>()
    const unique = all.filter((l) => {
      const key = l.url || `zoom:${l.listingId || l.title}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (unique.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No listings parsed — site layout may have changed.' },
        { status: 404 }
      )
    }

    // Zoom uses CASH FLOW or EBITDA — prefer CASH FLOW, fall back to EBITDA if missing.
    const upsert = await upsertBrokerListings(
      unique.map((l) => ({
        source: 'zoom',
        source_listing_url: l.url || `zoom:${l.listingId || l.title}`,
        title: l.title,
        asking_price_text: l.askingPrice,
        cash_flow_text: l.cashFlow || l.ebitda,
        location: l.location,
        // Zoom doesn't show revenue on the index — leave annual_revenue blank
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
    console.error('Zoom scrape error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
