import { NextResponse } from 'next/server'
import { upsertBrokerListings } from '@/lib/broker-listings'

export const runtime = 'nodejs'
export const maxDuration = 300

const BASE_URL = 'https://breareger.dealrelations.com/listings'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface BatesonListing {
  status: string
  title: string
  askingPrice: string
  annualRevenue: string
  cashFlow: string
  url: string
}

export async function POST() {
  let browser: import('puppeteer').Browser | null = null

  try {
    const puppeteer = (await import('puppeteer')).default

    browser = await puppeteer.launch({
      headless: false,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userDataDir: '/tmp/scraper-chrome-profile',
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1440,900',
      ],
    })

    const pages = await browser.pages()
    const page = pages[0] || (await browser.newPage())
    await page.setViewport({ width: 1440, height: 900 })
    await page.setUserAgent(USER_AGENT)

    const all: BatesonListing[] = []
    let pageNum = 1
    const MAX_PAGES = 20
    let lastError: string | null = null

    while (pageNum <= MAX_PAGES) {
      const url = `${BASE_URL}?page=${pageNum}`
      console.log(`Bateson: navigating page ${pageNum} → ${url}`)
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })

      // On the first page, handle Cloudflare and (if present) the login form.
      if (pageNum === 1) {
        // 1) Wait through Cloudflare interstitial if any (auto-resolves in most cases)
        const cfDeadline = Date.now() + 25_000
        while (Date.now() < cfDeadline) {
          const isChallenge = await page.evaluate(() =>
            /just a moment|attention required|checking your browser/i.test(document.title || '') ||
            /just a moment|attention required|checking your browser/i.test(document.body?.innerText?.slice(0, 500) || '')
          )
          if (!isChallenge) break
          await new Promise(r => setTimeout(r, 2000))
        }

        // 2) Detect login form — fill from env if credentials present
        const loginPresent = await page.evaluate(() => {
          return !!document.querySelector(
            'input[type="password"], input[name*="password" i], input[id*="password" i]'
          )
        })

        if (loginPresent) {
          const email = process.env.BATESON_EMAIL
          const password = process.env.BATESON_PASSWORD

          if (!email || !password || password === 'PASTE_YOUR_PASSWORD_HERE') {
            await browser.close()
            browser = null
            return NextResponse.json(
              {
                success: false,
                error:
                  'Bateson login form detected but BATESON_EMAIL / BATESON_PASSWORD not set in .env.local. Add the password and restart the dev server.',
              },
              { status: 401 }
            )
          }

          console.log('Bateson: login form detected — filling credentials from env...')

          // Find inputs (email-ish + password)
          const emailSelector = await page.evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll<HTMLInputElement>(
                'input[type="email"], input[name*="email" i], input[id*="email" i], input[name*="user" i], input[type="text"]'
              )
            )
            return candidates[0]?.id ? `#${candidates[0].id}` : (candidates[0]?.name ? `input[name="${candidates[0].name}"]` : '')
          })

          const passwordSelector = await page.evaluate(() => {
            const el = document.querySelector<HTMLInputElement>(
              'input[type="password"], input[name*="password" i], input[id*="password" i]'
            )
            return el?.id ? `#${el.id}` : (el?.name ? `input[name="${el.name}"]` : 'input[type="password"]')
          })

          if (!emailSelector || !passwordSelector) {
            await browser.close()
            browser = null
            return NextResponse.json(
              { success: false, error: 'Could not locate email or password field on Bateson login page.' },
              { status: 500 }
            )
          }

          await page.click(emailSelector, { clickCount: 3 }).catch(() => {})
          await page.type(emailSelector, email, { delay: 30 })
          await page.type(passwordSelector, password, { delay: 30 })

          // Submit — try button[type=submit], else press Enter
          const submitted = await page.evaluate(() => {
            const btn =
              document.querySelector<HTMLButtonElement>('button[type="submit"], input[type="submit"]') ||
              null
            if (btn) { btn.click(); return true }
            return false
          })
          if (!submitted) {
            await page.keyboard.press('Enter')
          }

          // Wait for navigation off the login page
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {})
          // After login, navigate explicitly to the listings page
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 })
        }
      }

      // Wait for the listings table on this page
      try {
        await page.waitForSelector('table', { timeout: 15_000 })
      } catch {
        lastError = `No table found on page ${pageNum}`
        break
      }

      // Extract rows
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('table tbody tr'))
        return trs.map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td'))
          const linkEl = tr.querySelector('a[href]') as HTMLAnchorElement | null
          const cellTexts = cells.map((c) => (c.textContent || '').trim().replace(/\s+/g, ' '))
          return {
            cells: cellTexts,
            href: linkEl?.getAttribute('href') || '',
          }
        })
      })

      if (rows.length === 0) {
        // Empty page — stop pagination
        break
      }

      for (const row of rows) {
        // Expected columns: [status, name, askingPrice, annualRevenue, cashFlow]
        // (Some sites prepend an extra cell — pad/skip defensively.)
        const c = row.cells
        if (c.length < 4) continue

        // Find the price-like columns (start with $) from the right
        const priceIdxs: number[] = []
        c.forEach((v, i) => {
          if (/^\$[\d,]+/.test(v)) priceIdxs.push(i)
        })

        const status = c[0] || ''
        // The title is the first non-status, non-price cell
        const titleIdx = c.findIndex(
          (v, i) => i > 0 && !/^\$[\d,]+/.test(v) && v.length > 2
        )
        const title = titleIdx >= 0 ? c[titleIdx] : ''
        const askingPrice = priceIdxs[0] !== undefined ? c[priceIdxs[0]] : ''
        const annualRevenue = priceIdxs[1] !== undefined ? c[priceIdxs[1]] : ''
        const cashFlow = priceIdxs[2] !== undefined ? c[priceIdxs[2]] : ''

        const href = row.href
        const url = href
          ? href.startsWith('http')
            ? href
            : `https://breareger.dealrelations.com${href.startsWith('/') ? href : '/' + href}`
          : ''

        if (title) {
          all.push({ status, title, askingPrice, annualRevenue, cashFlow, url })
        }
      }

      // Stop if no Next link present
      const hasNext = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'))
        return links.some(
          (a) =>
            /next/i.test(a.textContent || '') &&
            !a.classList.contains('disabled') &&
            !a.getAttribute('aria-disabled')
        )
      })
      if (!hasNext) break

      pageNum++
      await new Promise((r) => setTimeout(r, 800))
    }

    await browser.close()
    browser = null

    // Dedup by url+title
    const seen = new Set<string>()
    const unique = all.filter((l) => {
      const key = l.url || l.title
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (unique.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            lastError ||
            'No listings found. If a Cloudflare challenge or login screen appeared, sign in / solve it in the Chrome window — cookies will persist for the next run.',
        },
        { status: 404 }
      )
    }

    // Persist to Supabase. Bateson removes sold listings from the site, so any row
    // missing from this complete paginated scrape is auto-delisted.
    const upsert = await upsertBrokerListings(
      unique.map((l) => ({
        source: 'bateson',
        source_listing_url: l.url || `bateson:${l.title}`,
        title: l.title,
        asking_price_text: l.askingPrice,
        annual_revenue_text: l.annualRevenue,
        cash_flow_text: l.cashFlow,
        status: l.status,
        raw_data: l,
      })),
      { markDelisted: true }
    )

    return NextResponse.json({
      success: true,
      count: unique.length,
      pages: pageNum,
      listings: unique,
      storage: upsert,
      scrapedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (browser) await (browser as import('puppeteer').Browser).close().catch(() => {})
    console.error('Bateson scrape error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
