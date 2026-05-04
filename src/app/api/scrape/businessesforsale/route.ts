import { NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 120

// Services category, US, min $400K cash flow ("Profit.From=400K"), large page size
const BASE_URL =
  'https://us.businessesforsale.com/us/search/services-businesses-for-sale?Profit.From=400K'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface BFSListing {
  title: string
  url: string
  location: string
  askingPrice: string
  annualRevenue: string
  cashFlow: string
  description: string
}

/**
 * Parse a BusinessesForSale.com search results page.
 *
 * BFS uses a few different listing card layouts depending on listing type
 * (full listings vs. franchise vs. featured). Strategy:
 *   1. Find every <a> that links to a listing detail page (contains
 *      "/businesses-for-sale/" or "/franchises-for-sale/").
 *   2. Walk up to the surrounding card container.
 *   3. Within that card, extract asking price / revenue / cash flow / location
 *      by searching for label text.
 */
function parseListings(html: string, baseHref = 'https://us.businessesforsale.com'): BFSListing[] {
  const $ = cheerio.load(html)
  const listings: BFSListing[] = []
  const seenUrls = new Set<string>()

  // Find every listing detail link
  $('a[href*="/businesses-for-sale/"], a[href*="/franchises-for-sale/"]').each((_, a) => {
    const $a = $(a)
    const href = $a.attr('href') || ''
    // Skip filter / category / search-result count links
    if (
      !href ||
      /\/search\//.test(href) ||
      /^#/.test(href) ||
      href.endsWith('/businesses-for-sale/') ||
      href.endsWith('/franchises-for-sale/')
    ) {
      return
    }

    const title = ($a.text() || '').trim().replace(/\s+/g, ' ')
    if (!title || title.length < 4) return

    const url = href.startsWith('http')
      ? href
      : `${baseHref}${href.startsWith('/') ? href : '/' + href}`

    if (seenUrls.has(url)) return

    // Find the enclosing card — try several common container selectors,
    // walking up until we hit something that contains the financial labels.
    let $card = $a.closest('article, li, .result, .listing, .card, [data-result-id]')
    if (!$card.length) {
      // Fall back: walk up looking for a parent that holds "Asking Price"
      let $cur = $a.parent()
      for (let depth = 0; depth < 8 && $cur.length; depth++) {
        const text = $cur.text()
        if (/asking\s*price|cash\s*flow|revenue/i.test(text)) {
          $card = $cur
          break
        }
        $cur = $cur.parent()
      }
    }
    if (!$card.length) return

    const cardText = $card.text().replace(/\s+/g, ' ').trim()

    // Skip "Login to view" / "On request" cards that have no usable financials
    // unless they at least show a price line.
    const askingPrice = matchValue(cardText, /asking\s*price[:\s]*([^\n|·•]+?)(?=\s+(?:revenue|sales|turnover|cash\s*flow|profit|ebitda|location|$)|$)/i)
      || matchValue(cardText, /price[:\s]*\$?([\d.,]+(?:\s*[kmb])?)/i)

    const annualRevenue = matchValue(cardText, /(?:revenue|sales|turnover)[:\s]*([^\n|·•]+?)(?=\s+(?:cash\s*flow|profit|ebitda|location|asking|$)|$)/i)

    const cashFlow = matchValue(cardText, /(?:cash\s*flow|profit|ebitda|net\s*income)[:\s]*([^\n|·•]+?)(?=\s+(?:revenue|sales|turnover|location|asking|$)|$)/i)

    // Location: the "US" / "City, State" label usually sits near the title.
    // Try a sibling/descendant heuristic first, then fallback to a regex.
    let location = ''
    const $locationEl = $card.find('.location, [class*="location" i], [data-location]').first()
    if ($locationEl.length) {
      location = $locationEl.text().trim().replace(/\s+/g, ' ')
    }
    if (!location) {
      const m = cardText.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2}|US|United States)\b/)
      if (m) location = m[1]
    }

    // Description: longer text within the card that isn't the title or financials
    let description = ''
    const $desc = $card.find('p, .description, [class*="description" i]').first()
    if ($desc.length) description = $desc.text().trim().replace(/\s+/g, ' ').slice(0, 500)

    seenUrls.add(url)
    listings.push({
      title,
      url,
      location,
      askingPrice: cleanValue(askingPrice),
      annualRevenue: cleanValue(annualRevenue),
      cashFlow: cleanValue(cashFlow),
      description,
    })
  })

  return listings
}

function matchValue(text: string, re: RegExp): string {
  const m = text.match(re)
  return m && m[1] ? m[1].trim() : ''
}

function cleanValue(v: string): string {
  if (!v) return ''
  // Trim trailing labels that bled in from the next field
  return v
    .replace(/\b(revenue|sales|turnover|cash\s*flow|profit|ebitda|asking\s*price|price|location)\b.*$/i, '')
    .trim()
}

async function fetchPage(page: number): Promise<BFSListing[]> {
  const url = page === 1 ? `${BASE_URL}&PageSize=200` : `${BASE_URL}&PageSize=200&page=${page}`
  const { data: html } = await axios.get<string>(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 30_000,
  })
  return parseListings(html)
}

export async function POST() {
  try {
    const all: BFSListing[] = []
    let page = 1
    const MAX_PAGES = 25

    while (page <= MAX_PAGES) {
      const listings = await fetchPage(page)
      if (listings.length === 0) break
      // Stop if a page returns the exact same listings as the previous page
      // (means pagination didn't take effect)
      if (page > 1 && all.length > 0) {
        const prevLastUrl = all[all.length - 1]?.url
        const newFirstUrl = listings[0]?.url
        if (prevLastUrl && newFirstUrl && prevLastUrl === newFirstUrl) break
      }
      all.push(...listings)
      page++
      await new Promise((r) => setTimeout(r, 800))
    }

    // Dedup
    const seen = new Set<string>()
    const unique = all.filter((l) => {
      if (seen.has(l.url)) return false
      seen.add(l.url)
      return true
    })

    if (unique.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No listings parsed — site layout may have changed.' },
        { status: 404 }
      )
    }

    // BusinessesForSale removes sold listings, so unseen rows are auto-delisted.
    const upsert = await upsertBrokerListings(
      unique.map((l) => ({
        source: 'businessesforsale',
        source_listing_url: l.url,
        title: l.title,
        asking_price_text: l.askingPrice,
        annual_revenue_text: l.annualRevenue,
        cash_flow_text: l.cashFlow,
        location: l.location,
        description: l.description,
        raw_data: l,
      })),
      { markDelisted: true }
    )

    return NextResponse.json({
      success: true,
      count: unique.length,
      pages: page,
      listings: unique,
      storage: upsert,
      scrapedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('BusinessesForSale scrape error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
