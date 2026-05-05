import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import AccountActions from './AccountActions'

export const dynamic = 'force-dynamic'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in?next=/account')

  const params = await searchParams
  const justCheckedOut = params?.checkout === 'success'

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('subscription_status,current_period_end,stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  const status = profile?.subscription_status ?? null
  const isActive = status === 'active' || status === 'trialing'
  const periodEnd = profile?.current_period_end ? new Date(profile.current_period_end) : null

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg, #fafaf9)',
      fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif",
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 28,
          textDecoration: 'none', color: 'var(--text, #222)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, oklch(0.58 0.18 252) 0%, oklch(0.5 0.2 270) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 13, fontWeight: 700,
          }}>D</div>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>Nemmis</span>
        </Link>

        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, color: 'var(--text)' }}>
          Account
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>{user.email}</p>

        {justCheckedOut && (
          <div style={{
            background: 'oklch(0.96 0.04 155)', border: '1px solid oklch(0.86 0.08 155)',
            borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'oklch(0.4 0.13 155)',
            marginTop: 16,
          }}>
            ✓ Subscription active. Welcome to Nemmis.
          </div>
        )}

        {/* Subscription card */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: 24, marginTop: 20, boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Subscription
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginTop: 6 }}>
                {isActive ? 'Active' : status === 'past_due' ? 'Past due' : status === 'canceled' ? 'Canceled' : 'Inactive'}
              </div>
              {periodEnd && (
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                  {isActive ? 'Renews' : 'Ended'} {periodEnd.toLocaleDateString()}
                </div>
              )}
            </div>
            <span style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: isActive ? 'oklch(0.93 0.06 155)' : 'oklch(0.96 0.01 95)',
              color: isActive ? 'oklch(0.4 0.13 155)' : 'var(--text-3)',
            }}>
              {isActive ? '$19/mo' : 'No plan'}
            </span>
          </div>

          <AccountActions hasCustomer={!!profile?.stripe_customer_id} isActive={isActive} />
        </div>

        <form action="/auth/sign-out" method="post" style={{ marginTop: 16 }}>
          <button type="submit" style={{
            background: 'transparent', border: 'none', color: 'var(--text-3)',
            fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
          }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
