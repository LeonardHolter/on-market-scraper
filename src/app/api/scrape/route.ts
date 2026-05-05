import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { evaluateListing } from '@/lib/openai'

export const runtime = 'nodejs'
export const maxDuration = 120

const TARGET_URL =
  'https://www.bizbuysell.com/service-businesses-for-sale/?q=bHQ9MzAsNDAsODAmcGZyb209MTAwMDAwMCZwdG89MTAwMDAwMDA%3D'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

type FakePlugin = { name: string }
type FakePluginArray = FakePlugin[] & { item: (i: number) => FakePlugin; namedItem: (n: string) => FakePlugin | undefined; refresh: () => void }

async function applyStealthPatches(page: { evaluateOnNewDocument: (fn: () => void) => Promise<void> }) {
  await page.evaluateOnNewDocument(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false })

    // Fake plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }] as FakePluginArray
        arr.item = (i: number) => arr[i]
        arr.namedItem = (n: string) => arr.find((p) => p.name === n)
        arr.refresh = () => {}
        return arr
      }
    })

    // Fake languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })

    // Chrome runtime mock
    ;(window as unknown as { chrome: unknown }).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} }

    // Permissions mock
    const originalQuery = window.navigator.permissions?.query
    if (originalQuery) {
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters)
    }
  })
}

export async function POST(request: NextRequest) {
  let browser: { close: () => Promise<void> } | null = null

  try {
    const { platform } = await request.json()

    if (platform !== 'bizbuysell') {
      return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 })
    }

    // Dynamically import puppeteer to avoid Turbopack issues
    const puppeteer = (await import('puppeteer')).default

    console.log('Launching real Chrome...')

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
        '--start-maximized'
      ]
    })

    // Tab 1: homepage warmup
    const pages = await browser.pages()
    const tab1 = pages[0] || await browser.newPage()
    await applyStealthPatches(tab1)
    await tab1.setViewport({ width: 1440, height: 900 })
    await tab1.setUserAgent(USER_AGENT)

    console.log('Tab 1: Opening bizbuysell.com homepage...')
    await tab1.goto('https://www.bizbuysell.com/', { waitUntil: 'networkidle2', timeout: 30000 })
    await tab1.waitForTimeout(3000)

    // Tab 2: businesses-for-sale
    const tab2 = await browser.newPage()
    await applyStealthPatches(tab2)
    await tab2.setViewport({ width: 1440, height: 900 })
    await tab2.setUserAgent(USER_AGENT)

    console.log('Tab 2: Opening businesses-for-sale...')
    await tab2.goto('https://www.bizbuysell.com/businesses-for-sale/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    })

    console.log('Waiting 5 seconds before opening Tab 3...')
    await tab2.waitForTimeout(5000)

    // Tab 3: actual target
    const tab3 = await browser.newPage()
    await applyStealthPatches(tab3)
    await tab3.setViewport({ width: 1440, height: 900 })
    await tab3.setUserAgent(USER_AGENT)

    console.log('Tab 3: Navigating to target URL...')
    await tab3.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 })
    await tab3.waitForTimeout(3000)

    // Check blocked
    const blocked = await tab3.evaluate(() =>
      document.body?.innerText?.includes('Access Denied') || document.title?.includes('Access Denied')
    )

    const activePage = blocked ? tab2 : tab3

    if (blocked) {
      console.log('Tab 3 blocked, retrying via Tab 2...')
      await tab2.bringToFront()
      await tab2.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 })
      await tab2.waitForTimeout(3000)

      const stillBlocked = await tab2.evaluate(() =>
        document.body?.innerText?.includes('Access Denied')
      )

      if (stillBlocked) {
        await browser.close()
        return NextResponse.json(
          { error: 'BizBuySell is blocking access. Try running the scraper again — the Chrome profile may need another attempt to pass the bot check.' },
          { status: 403 }
        )
      }
    }

    console.log('Page accessible! Extracting listings...')

    // Wait for content
    await activePage.waitForSelector('a, .listing, article, [class*="card"]', { timeout: 10000 })
      .catch(() => {})

    const rawListings = await activePage.evaluate(() => {
      const containerSelectors = [
        '[class*="diamond"]',
        '[class*="businessCard"]',
        '[class*="listingCard"]',
        '.business-card',
        '.listing-card',
        '.result-item',
        'article',
      ]

      let items: Element[] = []
      for (const sel of containerSelectors) {
        const found = document.querySelectorAll(sel)
        if (found.length > 2) {
          items = Array.from(found).slice(0, 25)
          break
        }
      }

      // Fallback: grab listing anchor tags
      if (items.length === 0) {
        const links = document.querySelectorAll('a[href*="/Business-Opportunity/"]')
        items = Array.from(links).slice(0, 25)
      }

      return items.map((el) => {
        const titleEl = el.querySelector('h2, h3, h4, [class*="title"], [class*="name"]')
        const title =
          titleEl?.textContent?.trim() ||
          (el.tagName === 'A' ? el.textContent?.trim() : '') ||
          ''

        const priceEl = el.querySelector('[class*="price"], [class*="Price"]')
        const price = priceEl?.textContent?.trim() || 'Price not listed'

        const locationEl = el.querySelector('[class*="location"], [class*="city"], [class*="geo"]')
        const location = locationEl?.textContent?.trim() || 'Location not specified'

        const industryEl = el.querySelector('[class*="industry"], [class*="category"]')
        const industry = industryEl?.textContent?.trim() || 'Service Business'

        const descEl = el.querySelector('[class*="description"], [class*="summary"], p')
        const description = descEl?.textContent?.trim().substring(0, 400) || ''

        const linkEl = el.tagName === 'A' ? el as HTMLAnchorElement : el.querySelector('a[href]') as HTMLAnchorElement
        const href = linkEl?.getAttribute('href') || ''
        const url = href.startsWith('http') ? href : href ? `https://www.bizbuysell.com${href}` : ''

        return { title, price, location, industry, description, url }
      }).filter((l) => l.title.length > 3 && l.url.length > 10)
    })

    console.log(`Extracted ${rawListings.length} listings`)
    await activePage.waitForTimeout(3000)
    await browser.close()
    browser = null

    if (rawListings.length === 0) {
      return NextResponse.json(
        { error: 'No listings found. Page may have loaded but structure changed.' },
        { status: 404 }
      )
    }

    // AI evaluation + Supabase storage
    const processedListings: Record<string, unknown>[] = []
    const qualifiedListings: Record<string, unknown>[] = []

    for (let i = 0; i < Math.min(rawListings.length, 15); i++) {
      const listing = rawListings[i]
      const scraped = {
        ...listing,
        scraped_at: new Date().toISOString(),
        platform: 'BizBuySell',
        description: listing.description || `${listing.title} — ${listing.industry} in ${listing.location}`
      }

      console.log(`[${i + 1}/${Math.min(rawListings.length, 15)}] Evaluating: ${listing.title}`)

      try {
        const evaluation = await evaluateListing(scraped.title, scraped.description, scraped.industry)

        const processed = {
          ...scraped,
          evaluation_result: evaluation.analysis,
          gpt_analysis: evaluation.analysis,
          is_franchise: evaluation.isFranchise,
          is_design_firm: evaluation.isDesignFirm
        }

        processedListings.push(processed)

        if (evaluation.shouldStore) {
          const { error } = await supabaseAdmin
            .from('business_listings')
            .upsert([processed], { onConflict: 'url' })

          if (!error) {
            qualifiedListings.push(processed)
            console.log(`  ✅ Stored: ${listing.title}`)
          } else {
            console.error(`  ⚠️ DB error: ${error.message}`)
          }
        } else {
          console.log(`  ❌ Filtered (${evaluation.isFranchise ? 'franchise' : 'design firm'}): ${listing.title}`)
        }

        await new Promise((r) => setTimeout(r, 800))

      } catch (err) {
        console.error(`  Evaluation failed for ${listing.title}:`, err)
        processedListings.push({
          ...scraped,
          evaluation_result: 'Evaluation failed',
          gpt_analysis: 'Could not evaluate',
          is_franchise: false,
          is_design_firm: false
        })
      }
    }

    return NextResponse.json({
      success: true,
      results: processedListings,
      qualifiedListings,
      stats: {
        total: rawListings.length,
        processed: processedListings.length,
        qualified: qualifiedListings.length,
        franchises: processedListings.filter((l) => l.is_franchise).length,
        designFirms: processedListings.filter((l) => l.is_design_firm).length
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    if (browser) await browser.close().catch(() => {})
    console.error('Scraping error:', error)
    return NextResponse.json(
      { error: 'Scraping failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
