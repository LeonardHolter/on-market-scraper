# SaaS setup (auth + paywall + Stripe)

This adds anonymous click gating (3 free), Supabase Auth, and a $19/mo Stripe subscription.

## 1. Run the SQL migration

In the Supabase SQL editor, run:

```sql
-- file: database-schema-saas.sql
```

This creates `visitors`, `listing_clicks`, `profiles` (auto-created on sign-up via trigger), the `visitor_click_counts` view, and RLS policies.

## 2. Environment variables

Add these to `.env.local` and Vercel:

```bash
# Supabase (already present)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Stripe — get from https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_or_live_...
STRIPE_PRICE_ID=price_...        # the $19/mo recurring price
STRIPE_WEBHOOK_SECRET=whsec_...  # see step 4
```

## 3. Stripe: create the product + price

1. **Stripe Dashboard → Products → Add product**
   - Name: `Deal Flow Pro`
   - Pricing: **Recurring**, **$19.00 USD / month**
2. Copy the price id (`price_...`) → `STRIPE_PRICE_ID`

## 4. Stripe: configure the webhook

1. **Dashboard → Developers → Webhooks → Add endpoint**
2. URL: `https://<your-domain>/api/stripe/webhook`
3. Listen to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

For local testing:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# copy the whsec_... it prints into .env.local
```

## 5. Stripe: enable the customer portal

**Dashboard → Settings → Billing → Customer portal** → enable subscription cancellation, switch plans (off — we only have one), and update payment method.

## 6. Supabase Auth config

**Supabase Dashboard → Authentication → URL configuration**:

- **Site URL**: `https://<your-domain>` (or `http://localhost:3000` for dev)
- **Redirect URLs**: add `https://<your-domain>/auth/callback`

**Authentication → Providers → Email**: enable. Decide on email confirmations:

- **Off** (faster signup, recommended for MVP) → user is logged in immediately after sign-up.
- **On** → user receives an email link; the `/auth/callback` route handles it.

## 7. Test the flow

1. Open the site in an incognito window. You should see `3 / 3 free clicks` in the header.
2. Click 3 listings. The counter decrements and each opens in a new tab.
3. Click a 4th — the paywall modal appears.
4. Sign up → Pricing → Subscribe → Stripe Checkout → success → you land on `/account` with status **Active**.
5. Click any listing — opens directly, no paywall.
6. **Manage subscription** on `/account` opens the Customer Portal.

## How the gating works

- Anonymous visitors get a signed `df_vid` cookie → row in `visitors`. Each click logs to `listing_clicks(visitor_id, …)`. Server checks count vs. `FREE_CLICK_LIMIT` (3) on every click — *not* the client, so it can't be bypassed.
- Signed-in users with `profiles.subscription_status ∈ ('active','trialing')` always pass.
- The Stripe webhook is the source of truth — it writes `subscription_status` and `current_period_end` to `profiles`.

## Files added

```
src/lib/
  supabase-server.ts     # SSR Supabase client (cookie-bound)
  supabase-browser.ts    # browser Supabase client
  stripe.ts              # Stripe singleton
  visitor.ts             # df_vid cookie + visitor row
  entitlement.ts         # getEntitlement() + FREE_CLICK_LIMIT

src/middleware.ts        # refreshes auth session on every request

src/app/
  api/
    track-click/route.ts        # POST: gate + log + return redirect or paywall; GET: read entitlement
    stripe/
      checkout/route.ts         # POST: create Checkout session
      portal/route.ts           # POST: create Customer Portal session
      webhook/route.ts          # POST: Stripe events → update profiles
  auth/
    AuthForm.tsx                # email+password + magic-link
    AuthShell.tsx               # logo wrapper
    sign-in/page.tsx
    sign-up/page.tsx
    callback/route.ts           # exchanges ?code= for a session
    sign-out/route.ts
  pricing/page.tsx              # public pricing page → starts checkout
  account/
    page.tsx                    # subscription status + sign-out
    AccountActions.tsx          # buttons (manage / subscribe / portal)

database-schema-saas.sql        # SQL migration (run once)
```

## Tweaking the free-click limit

Edit `src/lib/entitlement.ts` → `FREE_CLICK_LIMIT`.
