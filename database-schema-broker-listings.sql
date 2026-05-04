-- Multi-source broker listings table.
-- Run in the Supabase SQL Editor. Idempotent.

create table if not exists broker_listings (
  id                  uuid primary key default gen_random_uuid(),

  -- Source identification
  source              text not null,                  -- 'synergy', 'bateson', 'bizbuysell', ...
  source_listing_url  text not null,                  -- canonical broker URL — used for dedupe
  title               text not null,

  -- Money — keep both the raw text and a parsed numeric for filtering
  asking_price_text     text,
  asking_price          numeric,
  annual_revenue_text   text,
  annual_revenue        numeric,
  cash_flow_text        text,
  cash_flow             numeric,

  -- Context
  location            text,
  status              text,
  description         text,
  industries          text[],

  -- Always keep the raw scrape so we can re-extract later without re-scraping
  raw_data            jsonb not null,

  -- Lifecycle
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  delisted_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (source, source_listing_url)
);

create index if not exists idx_broker_listings_source       on broker_listings (source);
create index if not exists idx_broker_listings_last_seen    on broker_listings (last_seen_at desc);
create index if not exists idx_broker_listings_asking_price on broker_listings (asking_price);
create index if not exists idx_broker_listings_cash_flow    on broker_listings (cash_flow);
create index if not exists idx_broker_listings_active       on broker_listings (delisted_at) where delisted_at is null;

-- Auto-bump updated_at on every update
create or replace function broker_listings_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_broker_listings_updated_at on broker_listings;
create trigger trg_broker_listings_updated_at
  before update on broker_listings
  for each row execute function broker_listings_set_updated_at();

-- RLS — keep simple for internal tool
alter table broker_listings enable row level security;

drop policy if exists "broker_listings all" on broker_listings;
create policy "broker_listings all" on broker_listings
  for all to authenticated, anon
  using (true) with check (true);
