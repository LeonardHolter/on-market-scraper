# 🚀 Quick Setup Guide

## Step 1: OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-`)

## Step 2: Supabase Setup

1. Go to [Supabase](https://supabase.com/)
2. Create a new project
3. Wait for project to be ready
4. Go to Settings > API
5. Copy these values:
   - **Project URL** (looks like: `https://abcdefgh.supabase.co`)
   - **anon/public key** (starts with `eyJhbGc...`)
   - **service_role key** (starts with `eyJhbGc...`)

## Step 3: Database Schema

1. In your Supabase project, go to **SQL Editor**
2. Copy and paste the entire contents of `database-schema.sql`
3. Click **Run** to create the table and indexes

## Step 4: Environment Variables

Update your `.env.local` file:

```bash
# OpenAI API Configuration
OPENAI_API_KEY=sk-your-actual-key-here

# Supabase Configuration  
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Step 5: Test Installation

1. Start the app: `npm run dev`
2. Open `http://localhost:3000`
3. Click "Start AI-Powered Scraping"
4. Watch for:
   - Browser opens automatically ✅
   - Listings appear with AI analysis ✅
   - Qualified listings show in database tab ✅

## 🎯 Expected Results

After a successful scrape:
- **Browser Window**: Opens and navigates to BizBuySell
- **AI Processing**: Each listing evaluated by ChatGPT
- **Smart Filtering**: Franchises and design firms automatically filtered out
- **Database Storage**: Qualified listings stored in Supabase
- **Dashboard Stats**: Real-time counts of qualified vs filtered listings

## 🆘 Need Help?

**OpenAI Issues**: Make sure you have credits and the API key is correct
**Supabase Issues**: Verify all three environment variables are set correctly
**Browser Issues**: Try running locally (not in cloud environments)

✨ **You're ready to discover qualified business opportunities with AI!**