import { NextResponse } from 'next/server'
import axios from 'axios'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * First Choice Business Brokers (fcbb.com).
 *
 * The site is a JS-rendered Duda CMS app — its listings are loaded via a
 * direct POST to api.fcbb.com/Fcbb/GetListings using three hard-coded site
 * tokens (captured from a real browser session). No login required.
 *
 * Response is JSON: { Items: [...], TotalItems, TotalPages, ... }
 *
 * Field mapping (verified against the live page):
 *   BusinessName     → title
 *   ListingPrice     → asking_price ("$X")
 *   GrossSales       → annual_revenue (Revenue line on the card)
 *   TotalIncome      → cash_flow (SDE / owner cash on the card)
 *   ListingUrl       → relative path → absolute URL on fcbb.com
 *   BusinessLocation → city/state
 */

const API_URL = 'https://api.fcbb.com/Fcbb/GetListings'
const SITE_BASE = 'https://fcbb.com'
const PAGE_SIZE = 500

const HEADERS = {
  'Content-Type': 'application/json',
  application_api_key: 'fcbb.web.api.token1',
  website_external_id: 'external.corporate.site.100001',
  website_reference_id: 'reference.corporate.site.100001',
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://fcbb.com',
  Referer: 'https://fcbb.com/',
}

interface FcbbListing {
  BusinessListingID?: string
  BusinessName?: string
  ListingPrice?: number
  GrossSales?: number
  TotalIncome?: number
  ListingUrl?: string
  ListingNumber?: string
  ListingNumberWithLocationCode?: string
  BusinessLocation?: string
  BusinessDescription?: string
  ReasonForSelling?: string
}

interface FcbbResponse {
  Items: FcbbListing[]
  CurrentPage: number
  PageSize: number
  TotalItems: number
  TotalPages: number
  Success: boolean
  Message?: string
}

async function fetchPage(page: number): Promise<FcbbResponse> {
  const body = {
    location: null,
    sort: null,
    keyword: null,
    pricefrom: '',
    priceto: '',
    choicetodisplay: '',
    selleractive: '',
    assetsale: '',
    pagesize: String(PAGE_SIZE),
    page: String(page),
    category: [null],
  }
  const { data } = await axios.post<FcbbResponse>(API_URL, body, {
    headers: HEADERS,
    timeout: 60_000,
  })
  return data
}

function fmtMoney(n: number | undefined | null): string {
  if (n == null || n === 0) return ''
  return `$${Math.round(n).toLocaleString()}`
}

/** Strip HTML tags + collapse whitespace for the description column. */
function stripHtml(html: string | undefined | null): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

export async function POST() {
  try {
    const first = await fetchPage(1)
    if (!first.Success || !Array.isArray(first.Items)) {
      return NextResponse.json(
        { success: false, error: first.Message || 'FCBB API returned no data' },
        { status: 502 }
      )
    }

    const all: FcbbListing[] = [...first.Items]
    const totalPages = first.TotalPages || 1
    for (let p = 2; p <= totalPages; p++) {
      const resp = await fetchPage(p)
      if (Array.isArray(resp.Items)) all.push(...resp.Items)
      await new Promise((r) => setTimeout(r, 400))
    }

    // Build listings using the existing broker_listings shape
    const seen = new Set<string>()
    const inputs = all
      .filter((l) => l.BusinessName && (l.ListingUrl || l.BusinessListingID))
      .map((l) => {
        const path = l.ListingUrl || `/listing/${l.BusinessListingID}`
        const url = path.startsWith('http')
          ? path
          : `${SITE_BASE}${path.startsWith('/') ? path : '/' + path}`
        return {
          source: 'fcbb',
          source_listing_url: url,
          title: (l.BusinessName || '').trim(),
          asking_price_text: fmtMoney(l.ListingPrice),
          annual_revenue_text: fmtMoney(l.GrossSales),
          cash_flow_text: fmtMoney(l.TotalIncome),
          location: (l.BusinessLocation || '').trim(),
          description: stripHtml(l.BusinessDescription),
          status: l.ReasonForSelling ? `Reason: ${l.ReasonForSelling}` : undefined,
          raw_data: l,
        }
      })
      .filter((l) => {
        if (seen.has(l.source_listing_url)) return false
        seen.add(l.source_listing_url)
        return true
      })

    if (inputs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No listings parsed from FCBB API.' },
        { status: 404 }
      )
    }

    // FCBB removes sold listings, so unseen rows in this complete scrape get auto-delisted.
    const upsert = await upsertBrokerListings(inputs, { markDelisted: true })

    return NextResponse.json({
      success: true,
      count: inputs.length,
      totalReportedByApi: first.TotalItems,
      pages: totalPages,
      storage: upsert,
      scrapedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('FCBB scrape error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
