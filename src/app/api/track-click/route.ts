import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getOrCreateVisitorId } from '@/lib/visitor'
import { getEntitlement, FREE_CLICK_LIMIT } from '@/lib/entitlement'

export const runtime = 'nodejs'

/**
 * POST { listingId } → records the click and returns the redirect target,
 * OR { paywall: true } if the visitor has used their free clicks.
 *
 * Always returns the entitlement state so the UI can update the counter.
 */
export async function POST(req: NextRequest) {
  let listingId: string | undefined
  try {
    const body = await req.json()
    listingId = body?.listingId
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!listingId) {
    return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  }

  // Resolve actor: signed-in user, or anonymous visitor cookie
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userId = user?.id ?? null

  const visitorId = userId
    ? null
    : await getOrCreateVisitorId({ userAgent: req.headers.get('user-agent') ?? undefined })

  // Check entitlement BEFORE recording the click
  const ent = await getEntitlement({ userId, visitorId, email: user?.email ?? null })
  if (ent.shouldPaywall) {
    return NextResponse.json({
      ok: false,
      paywall: true,
      isAuthed: ent.isAuthed,
      isSubscribed: ent.isSubscribed,
      clicksUsed: ent.clicksUsed,
      clicksRemaining: 0,
      limit: FREE_CLICK_LIMIT,
    })
  }

  // Look up the listing's external URL
  const { data: listing, error: listingErr } = await supabaseAdmin
    .from('broker_listings')
    .select('id,source_listing_url')
    .eq('id', listingId)
    .maybeSingle()

  if (listingErr || !listing?.source_listing_url) {
    return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  }

  // Record click (best-effort — don't block on failure)
  await supabaseAdmin.from('listing_clicks').insert({
    listing_id: listingId,
    user_id: userId,
    visitor_id: visitorId,
  })

  // Recompute remaining
  const after = await getEntitlement({ userId, visitorId, email: user?.email ?? null })

  return NextResponse.json({
    ok: true,
    redirect: listing.source_listing_url,
    isAuthed: after.isAuthed,
    isSubscribed: after.isSubscribed,
    shouldPaywall: after.shouldPaywall,
    clicksUsed: after.clicksUsed,
    clicksRemaining: after.clicksRemaining,
    limit: FREE_CLICK_LIMIT,
  })
}

/**
 * GET → just returns current entitlement (no click recorded). Used by the
 * client to render the free-click counter in the header.
 */
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userId = user?.id ?? null

  const visitorId = userId
    ? null
    : await getOrCreateVisitorId({ userAgent: req.headers.get('user-agent') ?? undefined })

  const ent = await getEntitlement({ userId, visitorId, email: user?.email ?? null })
  return NextResponse.json({
    ok: true,
    email: user?.email ?? null,
    isAuthed: ent.isAuthed,
    isSubscribed: ent.isSubscribed,
    shouldPaywall: ent.shouldPaywall,
    clicksUsed: ent.clicksUsed,
    clicksRemaining: ent.clicksRemaining,
    limit: FREE_CLICK_LIMIT,
  })
}
