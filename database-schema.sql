-- Create business_listings table in Supabase
-- Run this SQL in your Supabase SQL editor

CREATE TABLE business_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  price TEXT,
  location TEXT,
  industry TEXT,
  url TEXT UNIQUE NOT NULL,
  description TEXT,
  evaluation_result TEXT,
  gpt_analysis TEXT,
  is_franchise BOOLEAN DEFAULT FALSE,
  is_design_firm BOOLEAN DEFAULT FALSE,
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  platform TEXT DEFAULT 'BizBuySell'
);

-- Create indexes for better query performance
CREATE INDEX idx_business_listings_url ON business_listings(url);
CREATE INDEX idx_business_listings_platform ON business_listings(platform);
CREATE INDEX idx_business_listings_is_franchise ON business_listings(is_franchise);
CREATE INDEX idx_business_listings_is_design_firm ON business_listings(is_design_firm);
CREATE INDEX idx_business_listings_created_at ON business_listings(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE business_listings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust as needed for your security requirements)
CREATE POLICY "Allow all operations on business_listings" ON business_listings
FOR ALL 
TO authenticated, anon
USING (true)
WITH CHECK (true);