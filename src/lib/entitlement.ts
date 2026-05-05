import { supabaseAdmin } from './supabase'

/** Free clicks anonymous visitors get before being asked to sign up + pay. */
export const FREE_CLICK_LIMIT = 3

const ACTIVE_STATUSES = new Set(['active', 'trialing'])

/** Emails that always get full access without a subscription. */
const OWNER_EMAILS = new Set(['leonard@holterholdings.com'])

export interface Entitlement {
  /** Has an active paid subscription. */
  isSubscribed: boolean
  /** True if user is signed in (regardless of subscription). */
  isAuthed: boolean
  /** Number of clicks the visitor/user has used so far. */
  clicksUsed: number
  /** Free clicks remaining before paywall. -1 if subscribed. */
  clicksRemaining: number
  /** True if the next click should be blocked by the paywall. */
  shouldPaywall: boolean
}

/**
 * Compute entitlement for the current actor.
 * Either `userId` (signed-in) or `visitorId` (anonymous) must be provided.
 */
export async function getEntitlement(args: {
  userId?: string | null
  visitorId?: string | null
  email?: string | null
}): Promise<Entitlement> {
  const { userId, visitorId, email } = args
  const isAuthed = !!userId

  // Owner accounts: always allow, no subscription needed
  if (email && OWNER_EMAILS.has(email.toLowerCase())) {
    return { isSubscribed: true, isAuthed: true, clicksUsed: 0, clicksRemaining: -1, shouldPaywall: false }
  }

  // Subscribed users: always allow
  if (userId) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('subscription_status,current_period_end')
      .eq('id', userId)
      .maybeSingle()

    const status = profile?.subscription_status ?? null
    const stillValid =
      status === 'active' || status === 'trialing'
      // We trust Stripe to keep `subscription_status` accurate via webhook.
      // current_period_end is informational.

    if (status && ACTIVE_STATUSES.has(status) && stillValid) {
      return {
        isSubscribed: true,
        isAuthed: true,
        clicksUsed: 0,
        clicksRemaining: -1,
        shouldPaywall: false,
      }
    }
  }

  // Otherwise count clicks tied to this visitor (or this user if signed in but unsubscribed)
  let clicksUsed = 0
  if (userId) {
    const { count } = await supabaseAdmin
      .from('listing_clicks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    clicksUsed = count ?? 0
  } else if (visitorId) {
    const { count } = await supabaseAdmin
      .from('listing_clicks')
      .select('*', { count: 'exact', head: true })
      .eq('visitor_id', visitorId)
      .is('user_id', null)
    clicksUsed = count ?? 0
  }

  const clicksRemaining = Math.max(0, FREE_CLICK_LIMIT - clicksUsed)
  return {
    isSubscribed: false,
    isAuthed,
    clicksUsed,
    clicksRemaining,
    shouldPaywall: clicksRemaining <= 0,
  }
}
