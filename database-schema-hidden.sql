-- Migration: add is_hidden column for "not interesting" listings
ALTER TABLE broker_listings
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Index for fast filtering of visible listings
CREATE INDEX IF NOT EXISTS broker_listings_is_hidden_idx ON broker_listings (is_hidden);
