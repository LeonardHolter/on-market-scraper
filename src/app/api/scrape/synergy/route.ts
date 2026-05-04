import { NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE_URL =
  'https://synergybb.com/businesses-for-sale/?_listing_location_multi=arizona%2Ccalifornia%2Cdelaware%2Cflorida%2Cillinois%2Cmaryland%2Cmassachusetts%2Cnew-jersey%2Cnew-mexico%2Cnew-york%2Coklahoma%2Cpennsylvania%2Csouth-carolina%2Ctexas&_listing_industry_multi=services&_listing_net_cash_flow=498000.00%2C3021000.00'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface SynergyListing {
  title: string
  price: string
  annualRevenue: string
  cashFlow: string
  location: string
  description: string
  url: string
  industries: string[]
}

function parseListings(html: string): SynergyListing[] {
  const $ = cheerio.load(html)
  const listings: SynergyListing[] = []

  $('.sale-list-item').each((_, el) => {
    const $el = $(el)
    const $title = $el.find('.sale-list-item-title')

    const title = $title.text().trim()
    const url = $title.attr('href') || ''
    const price = $el.find('.sale-list-item-price').text().trim()

    // The h5 contains "Annual Revenue: $X" and "Net Cash Flow: $Y" in spans
    let annualRevenue = ''
    let cashFlow = ''
    $el.find('h5 span').each((_, span) => {
      const text = $(span).text().trim().replace(/\s+/g, ' ')
      const valueEl = $(span).find('strong').text().trim()
      if (/annual revenue/i.test(text)) annualRevenue = valueEl
      else if (/net cash flow|cash flow/i.test(text)) cashFlow = valueEl
    })

    const description = $el.find('.sale-list-item-content-dsec').text().trim()

    const industries: string[] = []
    $el.find('.sale-list-category li a').each((_, a) => {
      const t = $(a).text().trim()
      if (t) industries.push(t)
    })

    const location = $el
      .find('.sale-list-location-btn h6')
      .text()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*Learn More\s*$/i, '')
      .trim()

    if (title) {
      listings.push({
        title,
        price,
        annualRevenue,
        cashFlow,
        location,
        description,
        url,
        industries,
      })
    }
  })

  return listings
}

async function fetchPage(page: number): Promise<{ listings: SynergyListing[]; hasMore: boolean }> {
  const url = page === 1 ? BASE_URL : `${BASE_URL}&_paged=${page}`
  const { data: html } = await axios.get<string>(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 20000,
  })
  const listings = parseListings(html)
  return { listings, hasMore: listings.length > 0 }
}

export async function POST() {
  try {
    const all: SynergyListing[] = []
    let page = 1
    const MAX_PAGES = 10

    while (page <= MAX_PAGES) {
      const { listings, hasMore } = await fetchPage(page)
      if (listings.length === 0) break
      all.push(...listings)
      if (!hasMore) break
      page++
      // Be polite
      await new Promise(r => setTimeout(r, 600))
    }

    // Deduplicate by URL
    const seen = new Set<string>()
    const unique = all.filter(l => {
      if (seen.has(l.url)) return false
      seen.add(l.url)
      return true
    })

    // Persist to Supabase. Synergy doesn't auto-delist (it leaves "– Sold" titles
    // up for months) — sold detection happens via title pattern instead.
    const upsert = await upsertBrokerListings(
      unique.map((l) => ({
        source: 'synergy',
        source_listing_url: l.url,
        title: l.title,
        asking_price_text: l.price,
        annual_revenue_text: l.annualRevenue,
        cash_flow_text: l.cashFlow,
        location: l.location,
        description: l.description,
        industries: l.industries,
        raw_data: l,
      })),
      { markDelisted: false }
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
    console.error('Synergy scrape error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
