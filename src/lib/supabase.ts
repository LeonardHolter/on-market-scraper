import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// For server-side operations that require elevated permissions
export const supabaseAdmin = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface BusinessListing {
  id?: string
  title: string
  price: string
  location: string
  industry: string
  url: string
  description?: string
  evaluation_result?: string
  gpt_analysis?: string
  is_franchise?: boolean
  is_design_firm?: boolean
  scraped_at: string
  created_at?: string
  platform: string
}