-- Add change-tracking columns to broker_listings.
-- Idempotent — safe to re-run.

alter table broker_listings
  add column if not exists is_sold              boolean      default false,
  add column if not exists sold_detected_at     timestamptz,
  add column if not exists previous_asking_price numeric,
  add column if not exists price_changed_at     timestamptz,
  add column if not exists previous_title       text,
  add column if not exists title_changed_at     timestamptz;

create index if not exists idx_broker_listings_is_sold       on broker_listings (is_sold)        where is_sold = true;
create index if not exists idx_broker_listings_price_changed on broker_listings (price_changed_at desc nulls last);
create index if not exists idx_broker_listings_sold_detected on broker_listings (sold_detected_at desc nulls last);
