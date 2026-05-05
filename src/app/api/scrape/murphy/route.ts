import { NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Murphy Business Brokerage — WordPress site that paginates listings via an
 * admin-ajax POST. The initial HTML page only contains 10 listings; the rest
 * are loaded by clicking "page numbers" which fire `ajax_new_business_search_result`.
 *
 * We bypass pagination by calling the AJAX endpoint directly with a large
 * `per_page` (the site has ~470 listings as of Apr 2026). The response is a
 * server-rendered HTML fragment with one `<div class="card">` per listing:
 *   - .banner > p.tags        → status: "Active" / "Under Contract"
 *   - h5.card-title           → title
 *   - p.price                 → "$X" (or "$0" / "Confidential")
 *   - ul > li "SDE: $Y"       → seller's discretionary earnings (cash flow)
 *   - ul > li (with <img>)    → state / "Confidential"
 *   - a.btn.btn-primary[href] → detail page URL
 *
 * The `api_token` is hardcoded in inline JS on the listings page. If the site
 * rotates it, we'll need to re-fetch the listings page first to scrape it out.
 */

const AJAX_URL = 'https://murphybusiness.com/wp-admin/admin-ajax.php'
const REFERER  = 'https://murphybusiness.com/business-brokerage/view-our-listings/'

// Token observed in the inline script on the listings page (Apr 2026)
const API_TOKEN =
  '9TdcQA6JuhbEXZIbO2gEWnZixY94L2URzLCrTgYmTzVVt9DgDMvpIvE6gs3yBOYmyKPPUPuRelI2celrwWflKFtzzU0GDvXnd775DHxuzsy4zBQmXlIMnpyE2jmZocik'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface MurphyListing {
  title: string
  url: string
  askingPrice: string
  sde: string       // seller's discretionary earnings (≈ cash flow)
  location: string
  status: string
}

function clean(v: string): string {
  return v.replace(/\s+/g, ' ').trim()
}

function parseListings(html: string): MurphyListing[] {
  const $ = cheerio.load(html)
  const out: MurphyListing[] = []

  $('div.card').each((_, el) => {
    const $card = $(el)

    // Skip cards without a title or price (defensive — some templates reuse .card)
    const titleEl = $card.find('h5.card-title').first()
    const priceEl = $card.find('p.price').first()
    if (!titleEl.length || !priceEl.length) return

    const title = clean(titleEl.text())
    const askingPrice = clean(priceEl.text())
    if (!title) return

    const url = $card.find('a.btn.btn-primary').first().attr('href') ?? ''
    const status = clean($card.find('.banner p.tags').first().text()) || 'Active'

    // SDE row: <li>SDE: $X</li>
    let sde = ''
    $card.find('ul li').each((_, li) => {
      const t = clean($(li).text())
      const m = t.match(/^SDE:\s*(.+)$/i)
      if (m) sde = m[1].trim()
    })

    // Location row: <li><img ...>STATE</li> — find the li that contains an <img>
    let location = ''
    $card.find('ul li').each((_, li) => {
      const $li = $(li)
      if ($li.find('img').length > 0) {
        location = clean($li.text())
      }
    })

    out.push({ title, url, askingPrice, sde, location, status })
  })

  return out
}

export async function POST() {
  try {
    const form = new URLSearchParams({
      action: 'ajax_new_business_search_result',
      page_number: '1',
      per_page: '1000',
      api_token: API_TOKEN,
    })

    const res = await axios.post<string>(AJAX_URL, form.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: REFERER,
        Origin: 'https://murphybusiness.com',
      },
      timeout: 60_000,
      maxContentLength: 30 * 1024 * 1024,
      maxBodyLength: 30 * 1024 * 1024,
      validateStatus: () => true,
    })

    const html = res.data
    const status = res.status

    if (status !== 200) {
      console.error('[murphy] non-200', { status, snippet: String(html).slice(0, 400) })
      return NextResponse.json(
        { success: false, error: `Murphy AJAX returned HTTP ${status}`, snippet: String(html).slice(0, 400) },
        { status: 502 }
      )
    }

    const all = parseListings(html)

    // Deduplicate by URL
    const seen = new Set<string>()
    const unique = all.filter((l) => {
      const key = l.url || `murphy:${l.title}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (unique.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No listings parsed — token may have rotated or layout changed.',
          htmlLength: html.length,
          snippet: String(html).slice(0, 600),
        },
        { status: 404 }
      )
    }

    const upsert = await upsertBrokerListings(
      unique.map((l) => ({
        source: 'murphy',
        source_listing_url: l.url,
        title: l.title,
        // Murphy uses "$0" or "Confidential" for undisclosed — store empty so parsePrice yields null
        asking_price_text:
          /^\$?0(\.0+)?$/.test(l.askingPrice) || /confidential/i.test(l.askingPrice)
            ? ''
            : l.askingPrice,
        cash_flow_text: l.sde,
        location: /confidential/i.test(l.location) ? '' : l.location,
        status: l.status,
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
    console.error('Murphy scrape error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
