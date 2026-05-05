-- ─── SaaS layer: anonymous click tracking + paid subscriptions ──────────────
-- Run this AFTER existing schema files. Idempotent.

-- 1) Anonymous visitors -------------------------------------------------------
create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  user_agent text,
  created_at timestamptz not null default now()
);

-- 2) Listing click log (anonymous OR signed-in) -------------------------------
create table if not exists public.listing_clicks (
  id bigserial primary key,
  visitor_id uuid references public.visitors(id) on delete set null,
  user_id    uuid references auth.users(id)     on delete set null,
  listing_id uuid references public.broker_listings(id) on delete cascade,
  clicked_at timestamptz not null default now()
);

create index if not exists listing_clicks_visitor_idx on public.listing_clicks (visitor_id, clicked_at desc);
create index if not exists listing_clicks_user_idx    on public.listing_clicks (user_id, clicked_at desc);

-- 3) User profile mirroring auth.users with subscription state ----------------
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  -- Stripe subscription.status: trialing | active | past_due | canceled | incomplete | incomplete_expired | unpaid | paused
  subscription_status    text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id);

-- 4) Auto-create profile when a new auth.user signs up -----------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5) updated_at trigger on profiles ------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- 6) RLS: users can read their own profile -----------------------------------
alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- (Service role bypasses RLS — webhook + server actions use service key.)

-- 7) View: count of anonymous clicks per visitor (helper for free-tier gate) -
create or replace view public.visitor_click_counts as
select visitor_id, count(*)::int as clicks
from public.listing_clicks
where visitor_id is not null and user_id is null
group by visitor_id;
