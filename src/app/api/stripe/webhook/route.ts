import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

/**
 * Stripe webhook handler. Configure in Stripe dashboard with these events:
 *   - checkout.session.completed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *
 * URL: https://<your-domain>/api/stripe/webhook
 * Add STRIPE_WEBHOOK_SECRET to env.
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) {
    return NextResponse.json({ error: 'missing signature/secret' }, { status: 400 })
  }

  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret)
  } catch (e) {
    console.error('[stripe webhook] signature verify failed:', e)
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = (session.metadata?.supabase_user_id as string) ?? null
        const customerId = (session.customer as string) ?? null
        const subscriptionId = (session.subscription as string) ?? null
        if (userId && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId)
          await upsertSubscription(userId, customerId, sub)
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId =
          (sub.metadata?.supabase_user_id as string) ??
          (await lookupUserIdByCustomer(sub.customer as string))
        if (userId) await upsertSubscription(userId, sub.customer as string, sub)
        break
      }

      default:
        // ignore
        break
    }
  } catch (e) {
    console.error('[stripe webhook] handler error:', e)
    return NextResponse.json({ error: 'handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function lookupUserIdByCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return data?.id ?? null
}

async function upsertSubscription(
  userId: string,
  customerId: string,
  sub: Stripe.Subscription
) {
  const item = sub.items.data[0]
  // Stripe types: current_period_end lives on the subscription item in newer API versions
  const periodEnd =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (sub as unknown as { current_period_end?: number })?.current_period_end ??
    null

  await supabaseAdmin
    .from('profiles')
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    })
    .eq('id', userId)
}
