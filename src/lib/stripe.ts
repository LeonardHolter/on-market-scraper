import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  // Don't throw at import — allow build / non-payment routes to work without it
  console.warn('[stripe] STRIPE_SECRET_KEY missing — payment routes will fail.')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_missing', {
  // Pin to a stable API version
  apiVersion: '2026-04-22.dahlia',
  appInfo: {
    name: 'Deal Flow',
  },
})

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? ''
