import { NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * BusinessesForSale.com — services category, US, min $400K cash flow.
 *
 * HTML structure (verified live):
 *   <div class="result">
 *     <table class="result-table">
 *       <caption><h2><a href="...">Title</a></h2></caption>
 *       <tbody class="pure-g">
 *         <tr class="t-loc"><th>Location:</th><td>US</td></tr>
 *         <tr class="t-labels">…New / Established / Hot etc.…</tr>
 *         <tr class="t-desc"><td><a class="t-thumb">…</a><p>Description… <a class="details-link">More details »</a></p></td></tr>
 *         <tr class="t-finance"><td colspan="2"><table><tbody>
 *           <tr><th>Asking Price:</th><td>$X</td></tr>
 *           <tr><th>Revenue:</th>     <td>$X</td></tr>
 *           <tr><th>Cash Flow:</th>   <td>$X</td></tr>
 *         </tbody></table></td></tr>
 *       </tbody>
 *     </table>
 *   </div>
 */

const BASE_URL =
  'https://us.businessesforsale.com/us/search/services-businesses-for-sale?Profit.From=400K'
const PAGE_SIZE = 500
const MAX_PAGES = 25 // 25 × 500 = 12,500 max — well above the ~5,000 listings BFS returns

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface BFSListing {
  title: string
  url: string
  location: string
  status: string
  askingPrice: string
  annualRevenue: string
  cashFlow: string
  description: string
}

function parseListings(html: string): BFSListing[] {
  const $ = cheerio.load(html)
  const out: BFSListing[] = []

  $('div.result').each((_, el) => {
    const $el = $(el)

    const $titleA = $el.find('table.result-table > caption h2 a').first()
    const title = ($titleA.text() || '').trim().replace(/\s+/g, ' ')
    const url = ($titleA.attr('href') || '').trim()
    if (!title || !url) return

    const location = $el
      .find('tr.t-loc > td')
      .first()
      .text()
      .trim()
      .replace(/\s+/g, ' ')

    const status = $el
      .find('tr.t-labels .result-labels')
      .text()
      .trim()
      .replace(/\s+/g, ' ')

    // Description is the <p> in the t-desc row, but we want the visible text
    // before the "More details »" link
    const $descTd = $el.find('tr.t-desc > td').first()
    let description = ''
    if ($descTd.length) {
      const $p = $descTd.find('p').first().clone()
      $p.find('a.details-link').remove()
      description = $p.text().trim().replace(/\s+/g, ' ').slice(0, 600)
    }

    // Financials: nested table inside tr.t-finance
    let askingPrice = ''
    let annualRevenue = ''
    let cashFlow = ''
    $el.find('tr.t-finance table tr').each((_, row) => {
      const $row = $(row)
      const label = $row.find('th').text().trim().toLowerCase()
      const value = $row.find('td').text().trim().replace(/\s+/g, ' ')
      if (!label || !value) return
      if (label.startsWith('asking price')) askingPrice = value
      else if (label.startsWith('revenue') || label.startsWith('sales') || label.startsWith('turnover')) {
        annualRevenue = value
      } else if (label.startsWith('cash flow') || label.startsWith('net profit') || label.startsWith('ebitda')) {
        cashFlow = value
      }
    })

    out.push({
      title,
      url,
      location,
      status,
      askingPrice,
      annualRevenue,
      cashFlow,
      description,
    })
  })

  return out
}

async function fetchPage(page: number): Promise<BFSListing[]> {
  const url = `${BASE_URL}&PageSize=${PAGE_SIZE}${page > 1 ? `&page=${page}` : ''}`
  const { data: html } = await axios.get<string>(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 60_000,
    // Big pages can be 5+ MB
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  })
  return parseListings(html)
}

export async function POST() {
  try {
    const all: BFSListing[] = []
    const seenUrls = new Set<string>()
    let page = 1
    let prevFirstUrl: string | null = null

    while (page <= MAX_PAGES) {
      const listings = await fetchPage(page)
      if (listings.length === 0) break

      // Pagination didn't advance — same first row as previous page → stop
      if (page > 1 && listings[0]?.url === prevFirstUrl) break
      prevFirstUrl = listings[0]?.url ?? null

      let added = 0
      for (const l of listings) {
        if (seenUrls.has(l.url)) continue
        seenUrls.add(l.url)
        all.push(l)
        added++
      }

      // If page returned less than PAGE_SIZE, we're done
      if (listings.length < PAGE_SIZE) break
      // If nothing new was added, we're seeing duplicates — stop
      if (added === 0) break

      page++
      await new Promise((r) => setTimeout(r, 600))
    }

    if (all.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No listings parsed — site layout may have changed.' },
        { status: 404 }
      )
    }

    // BFS removes sold listings, so unseen rows in this complete scrape get auto-delisted.
    const upsert = await upsertBrokerListings(
      all.map((l) => ({
        source: 'businessesforsale',
        source_listing_url: l.url,
        title: l.title,
        asking_price_text: l.askingPrice,
        annual_revenue_text: l.annualRevenue,
        cash_flow_text: l.cashFlow,
        location: l.location,
        status: l.status,
        description: l.description,
        raw_data: l,
      })),
      { markDelisted: true }
    )

    return NextResponse.json({
      success: true,
      count: all.length,
      pages: page,
      storage: upsert,
      scrapedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('BusinessesForSale scrape error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
