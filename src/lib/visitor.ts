import { cookies } from 'next/headers'
import { supabaseAdmin } from './supabase'

export const VISITOR_COOKIE = 'df_vid'
const ONE_YEAR_S = 60 * 60 * 24 * 365

/**
 * Returns the current anonymous visitor id, creating one (and a row in
 * `visitors`) if this is the first request from this browser.
 * Must be called from a route handler / server action — anywhere cookies()
 * can be written.
 */
export async function getOrCreateVisitorId(opts?: { userAgent?: string }): Promise<string> {
  const jar = await cookies()
  const existing = jar.get(VISITOR_COOKIE)?.value
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing

  const { data, error } = await supabaseAdmin
    .from('visitors')
    .insert({ user_agent: opts?.userAgent ?? null })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create visitor')

  jar.set(VISITOR_COOKIE, data.id, {
    path: '/',
    maxAge: ONE_YEAR_S,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })

  return data.id
}
