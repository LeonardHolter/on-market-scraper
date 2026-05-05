import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 300

const BASE_URL = 'https://www.sunbeltnetwork.com/business-search/business-results'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const CONCURRENCY = 5   // parallel browser tabs
const DELAY_MS = 600    // polite delay between batches

interface SunbeltListing {
  title: string
  url: string
  location: string
  askingPrice: string
  grossRevenue: string
  cashFlow: string
}

function parseListingsFromHtml(html: string): SunbeltListing[] {
  const $ = cheerio.load(html)
  const listings: SunbeltListing[] = []

  $('article.latestBusinesses__item').each((_, el) => {
    const $el = $(el)

    const title = $el.find('h4.latestBusinesses__item--title').text().trim()

    // The listing URL appears on the title link and the "View Listing" button
    let url = ''
    $el.find('a[href*="listing-details"]').each((_, a) => {
      const href = $(a).attr('href') || ''
      if (href && !url) url = href
    })

    const location = $el.find('.latestBusinesses__location').text().trim()

    // Financial values: each box has a <strong> (value) and <span> (label)
    let grossRevenue = ''
    let cashFlow = ''
    $el.find('.latestBusinesses__values--box').each((_, box) => {
      const label = $(box).find('span').text().trim().toLowerCase()
      const value = $(box).find('strong').text().trim()
      if (label.includes('gross revenue')) grossRevenue = value
      else if (label.includes('cash flow')) cashFlow = value
    })

    // Asking price — appears in the right column (.latestBusinesses__item--rightPrice)
    const askingPrice = $el.find('.latestBusinesses__item--rightPrice').first().text().trim()

    if (title) {
      listings.push({ title, url, location, askingPrice, grossRevenue, cashFlow })
    }
  })

  return listings
}

function parseMoney(raw: string): number | null {
  if (!raw) return null
  // e.g. "$30m", "$1.5m", "$500k", "$1,200,000", "Not Disclosed", "Confidential"
  const s = raw.toLowerCase().replace(/[\s,]/g, '')
  if (!s || s === 'notdisclosed' || s === 'confidential' || s === 'n/a' || s === '-') return null
  const mMatch = s.match(/^\$?([\d.]+)m$/)
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000)
  const kMatch = s.match(/^\$?([\d.]+)k$/)
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000)
  const plain = s.replace(/^\$/, '').replace(/[^0-9.]/g, '')
  const n = parseFloat(plain)
  return isNaN(n) ? null : Math.round(n)
}

async function fetchPageHtml(
  browser: import('puppeteer').Browser,
  pageNum: number
): Promise<string> {
  const url =
    pageNum === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${pageNum}/`

  const tab = await browser.newPage()
  try {
    await tab.setUserAgent(USER_AGENT)
    await tab.setRequestInterception(true)
    // Block images, fonts, and analytics to speed up page loads
    tab.on('request', (req) => {
      const type = req.resourceType()
      const u = req.url()
      if (
        type === 'image' ||
        type === 'font' ||
        type === 'media' ||
        u.includes('google') ||
        u.includes('facebook') ||
        u.includes('clarity') ||
        u.includes('cookieyes') ||
        u.includes('linkedin') ||
        u.includes('aplo-evnt')
      ) {
        req.abort()
      } else {
        req.continue()
      }
    })
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // Wait for the listing container to appear
    await tab.waitForSelector('article.latestBusinesses__item', { timeout: 15_000 }).catch(() => {})
    return await tab.content()
  } finally {
    await tab.close().catch(() => {})
  }
}

export async function POST() {
  let browser: import('puppeteer').Browser | null = null

  try {
    const puppeteer = (await import('puppeteer')).default

    // Try system Chrome first (local dev), fall back to bundled Chromium (Vercel)
    const executablePath = (() => {
      const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      try {
        require('fs').accessSync(mac)
        return mac
      } catch {
        return undefined // use puppeteer's bundled Chromium
      }
    })()

    browser = await puppeteer.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
      ],
    })

    // --- Step 1: load page 1 to get total page count ---
    const firstHtml = await fetchPageHtml(browser, 1)
    const $first = cheerio.load(firstHtml)

    // Parse total from "Listings 1 - 10 of 1359 Results"
    const countText = $first('.countListing').first().text().trim()
    const totalCount = parseInt(countText.replace(/,/g, ''), 10) || 0
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / 10) : 136

    const allListings: SunbeltListing[] = parseListingsFromHtml(firstHtml)
    const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)

    // --- Step 2: scrape remaining pages in parallel batches ---
    for (let i = 0; i < pageNums.length; i += CONCURRENCY) {
      const batch = pageNums.slice(i, i + CONCURRENCY)
      const htmls = await Promise.all(batch.map((n) => fetchPageHtml(browser!, n)))
      for (const html of htmls) {
        allListings.push(...parseListingsFromHtml(html))
      }
      if (i + CONCURRENCY < pageNums.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS))
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>()
    const unique = allListings.filter((l) => {
      const key = l.url || l.title
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Persist to Supabase
    const upsert = await upsertBrokerListings(
      unique.map((l) => ({
        source: 'sunbelt',
        source_listing_url: l.url,
        title: l.title,
        asking_price_text: l.askingPrice,
        asking_price: parseMoney(l.askingPrice),
        annual_revenue_text: l.grossRevenue,
        annual_revenue: parseMoney(l.grossRevenue),
        cash_flow_text: l.cashFlow,
        cash_flow: parseMoney(l.cashFlow),
        location: l.location || null,
        raw_data: l,
      })),
      { markDelisted: true }
    )

    return NextResponse.json({
      success: true,
      count: unique.length,
      pages: totalPages,
      storage: upsert,
      scrapedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Sunbelt scrape error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  } finally {
    await browser?.close().catch(() => {})
  }
}
