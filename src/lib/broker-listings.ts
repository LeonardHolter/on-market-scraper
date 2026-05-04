import { supabaseAdmin } from './supabase'

export interface BrokerListingInput {
  source: string
  source_listing_url: string
  title: string
  asking_price_text?: string
  annual_revenue_text?: string
  cash_flow_text?: string
  location?: string
  status?: string
  description?: string
  industries?: string[]
  raw_data: unknown
}

export interface UpsertResult {
  total: number
  inserted: number
  updated: number
  errors: number
  priceChanged: number
  titleChanged: number
  newlySold: number
  delisted: number
}

/** Title patterns that indicate the listing is no longer truly available. */
const SOLD_PATTERN = /\b(sold|accepted offer|under contract|sale pending|deal pending)\b/i

/** Parse "$6,750,000" / "$1.2M" / "1,500" into a number. */
export function parsePrice(text: string | undefined | null): number | null {
  if (!text) return null
  const cleaned = String(text).trim().toLowerCase().replace(/,/g, '').replace(/\$/g, '')
  if (!cleaned) return null
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?\b/)
  if (!m) return null
  const base = parseFloat(m[1])
  if (Number.isNaN(base)) return null
  const suffix = m[2]
  const mult =
    suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1
  return Math.round(base * mult)
}

interface ExistingRow {
  id: string
  source_listing_url: string
  title: string
  asking_price: number | null
  is_sold: boolean | null
  delisted_at: string | null
}

/**
 * Upsert a batch of listings for a single source. Detects:
 *   - title changes (and "sold" markers — Synergy-style)
 *   - price changes
 *   - delisting (rows previously seen for this source but missing from this scrape)
 *
 * `markDelisted` should be true only when the scrape covered the FULL set for that source
 * (e.g., paginated to completion). Pass false if the scrape was partial.
 */
export async function upsertBrokerListings(
  inputs: BrokerListingInput[],
  options: { markDelisted: boolean }
): Promise<UpsertResult> {
  const result: UpsertResult = {
    total: inputs.length,
    inserted: 0,
    updated: 0,
    errors: 0,
    priceChanged: 0,
    titleChanged: 0,
    newlySold: 0,
    delisted: 0,
  }
  if (inputs.length === 0) return result

  const source = inputs[0].source
  const now = new Date().toISOString()
  const seenUrls = new Set<string>()
  const filtered = inputs.filter((l) => {
    if (!l.title || !l.source_listing_url) return false
    if (seenUrls.has(l.source_listing_url)) return false
    seenUrls.add(l.source_listing_url)
    return true
  })
  if (filtered.length === 0) return result

  // Fetch existing rows for this source — only the URLs in this scrape (for diffing)
  const urls = filtered.map((l) => l.source_listing_url)
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('broker_listings')
    .select('id,source_listing_url,title,asking_price,is_sold,delisted_at')
    .eq('source', source)
    .in('source_listing_url', urls)

  if (selErr) {
    console.error('[broker_listings] select error:', selErr)
  }
  const byUrl = new Map<string, ExistingRow>()
  for (const r of (existing as ExistingRow[]) || []) {
    byUrl.set(r.source_listing_url, r)
  }

  // Build upsert rows with change tracking
  const rows = filtered.map((l) => {
    const prev = byUrl.get(l.source_listing_url)
    const newPrice = parsePrice(l.asking_price_text)
    const newSold = SOLD_PATTERN.test(l.title)

    const changes: Record<string, unknown> = {
      source: l.source,
      source_listing_url: l.source_listing_url,
      title: l.title,
      asking_price_text: l.asking_price_text || null,
      asking_price: newPrice,
      annual_revenue_text: l.annual_revenue_text || null,
      annual_revenue: parsePrice(l.annual_revenue_text),
      cash_flow_text: l.cash_flow_text || null,
      cash_flow: parsePrice(l.cash_flow_text),
      location: l.location || null,
      status: l.status || null,
      description: l.description || null,
      industries: l.industries && l.industries.length > 0 ? l.industries : null,
      raw_data: l.raw_data ?? {},
      last_seen_at: now,
      // If a delisted listing reappears, un-delist it
      delisted_at: prev?.delisted_at ? null : undefined,
      is_sold: newSold,
    }

    if (prev) {
      // Title change
      if (prev.title !== l.title) {
        changes.previous_title = prev.title
        changes.title_changed_at = now
        result.titleChanged++

        // Newly sold (title now matches sold pattern, didn't before)
        const wasSold = !!prev.is_sold
        if (newSold && !wasSold) {
          changes.sold_detected_at = now
          result.newlySold++
        }
      } else if (newSold && !prev.is_sold) {
        // Edge case: stored row missed the sold flag (e.g., before this code shipped)
        changes.sold_detected_at = now
        result.newlySold++
      }

      // Price change
      if (newPrice != null && prev.asking_price != null && newPrice !== prev.asking_price) {
        changes.previous_asking_price = prev.asking_price
        changes.price_changed_at = now
        result.priceChanged++
      }
    } else if (newSold) {
      // New row that's already sold (title contained sold marker on first sight)
      changes.sold_detected_at = now
      result.newlySold++
    }

    // Strip undefined keys so they don't override defaults
    return Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined))
  })

  const { error } = await supabaseAdmin
    .from('broker_listings')
    .upsert(rows, { onConflict: 'source,source_listing_url' })

  if (error) {
    console.error('[broker_listings] upsert error:', error)
    result.errors = rows.length
    return result
  }

  for (const r of filtered) {
    if (byUrl.has(r.source_listing_url)) result.updated++
    else result.inserted++
  }

  // Mark stale (not seen this scrape) rows as delisted, if the scrape was complete
  if (options.markDelisted) {
    // Only consider rows that are currently active (not already delisted)
    const { data: activeRows, error: activeErr } = await supabaseAdmin
      .from('broker_listings')
      .select('id,source_listing_url')
      .eq('source', source)
      .is('delisted_at', null)

    if (!activeErr && activeRows) {
      const toDelist = activeRows
        .filter((r) => !seenUrls.has(r.source_listing_url))
        .map((r) => r.id)

      if (toDelist.length > 0) {
        const { error: delErr } = await supabaseAdmin
          .from('broker_listings')
          .update({ delisted_at: now })
          .in('id', toDelist)
        if (delErr) {
          console.error('[broker_listings] delist error:', delErr)
        } else {
          result.delisted = toDelist.length
        }
      }
    }
  }

  return result
}
