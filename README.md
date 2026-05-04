# AI-Powered Deal Flow Scraper

An intelligent Next.js TypeScript platform that scrapes business listings, evaluates them with ChatGPT, filters out unwanted businesses (franchises & design firms), and stores qualified opportunities in Supabase.

## 🚀 Features

### 🤖 **AI-Powered Intelligence**
- **ChatGPT Integration**: Automatically evaluates each listing using OpenAI API
- **Smart Filtering**: Identifies and filters out franchises and design firms
- **Intelligent Analysis**: Provides reasoning for each decision

### 🎯 **Enhanced Scraping**
- **Targeted URL**: Scrapes specific service business listings with filters
- **Interactive Browser**: Watch the scraping process in real-time
- **Robust Extraction**: Multiple fallback strategies for data extraction
- **Detailed Information**: Extracts title, price, location, industry, and descriptions

### 💾 **Database Storage**
- **Supabase Integration**: Automatically stores qualified listings
- **Duplicate Prevention**: Prevents storing the same listing twice
- **Full CRUD**: View, manage, and delete stored listings
- **Statistics Tracking**: Real-time stats on qualified vs filtered listings

### 🎨 **Modern Interface**
- **Dual View**: Toggle between latest scrape results and stored database
- **Real-time Stats**: Dashboard showing qualified listings, franchises filtered, etc.
- **Color-coded Results**: Visual indicators for qualified, franchise, and design firm listings
- **Responsive Design**: Beautiful UI that works on all devices

## 🛠 Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS 4
- **Scraping**: Puppeteer (with visible browser)
- **AI**: OpenAI GPT-3.5-turbo API
- **Database**: Supabase (PostgreSQL)
- **API**: Next.js API Routes

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- OpenAI API key
- Supabase account and project

### Setup Steps

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd deal-flow-scraper
   npm install
   ```

2. **Configure Environment Variables**
   
   Update `.env.local` with your credentials:
   ```bash
   # OpenAI API Configuration
   OPENAI_API_KEY=sk-your-openai-api-key-here

   # Supabase Configuration  
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   ```

3. **Setup Supabase Database**
   
   Run the SQL in `database-schema.sql` in your Supabase SQL editor:
   ```sql
   -- This creates the business_listings table with proper indexes and RLS
   -- Copy and paste the contents of database-schema.sql
   ```

4. **Start the Development Server**
   ```bash
   npm run dev
   ```

5. **Open the Application**
   
   Navigate to `http://localhost:3000`

## 🎯 Usage

### 🚀 **Quick Start**
1. **Launch the Application**: Open `http://localhost:3000`
2. **Start AI Scraping**: Click "Start AI-Powered Scraping"
3. **Watch the Process**: Browser opens and you can watch the scraping live
4. **View Results**: See real-time AI evaluation and filtering
5. **Manage Database**: Switch to "Qualified Database" tab to view stored listings

### 🎨 **Interface Overview**

**Dashboard Stats**: 
- View total qualified listings stored
- See latest scrape statistics (qualified vs filtered)
- Track franchises and design firms automatically filtered out

**Latest Scrape Results Tab**:
- Color-coded listings (Green = Qualified, Red = Franchise, Orange = Design Firm)  
- AI analysis explanation for each listing
- Real-time processing feedback

**Qualified Database Tab**:
- View all stored qualified opportunities
- Delete unwanted entries
- Track when each listing was added
- Direct links to original listings

### 🤖 **AI Evaluation Process**
Each scraped listing is automatically:
1. **Analyzed by ChatGPT**: Evaluates title, description, and industry
2. **Categorized**: Identifies franchises and design firms
3. **Filtered**: Only non-franchise, non-design businesses are stored
4. **Stored**: Qualified listings saved to Supabase with full details

## 🏗 Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── scrape/
│   │       └── route.ts      # Scraping API endpoint
│   ├── globals.css           # Global styles
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main dashboard page
└── ...
```

## 👀 Interactive Browser Scraping

This scraper now opens a **visible browser window** so you can watch the scraping process in real-time! When you click "Start Scraping":

1. 🌐 A Chrome browser window opens with developer tools
2. 🔍 The scraper navigates to BizBuySell.com
3. 🤖 You can see it interact with page elements (dismiss popups, find listings)
4. 📊 Data is extracted using live DOM manipulation
5. ⏱️ Browser stays open for 3 seconds so you can see the results
6. ✅ Browser automatically closes and returns data

## 🔧 API Endpoints

### POST /api/scrape
Enhanced AI-powered scraping with automatic evaluation and storage.

**Request Body:**
```json
{
  "platform": "bizbuysell"
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "title": "Business Name",
      "price": "$125,000",
      "location": "City, State", 
      "industry": "Service Business",
      "description": "Detailed business description...",
      "url": "https://...",
      "evaluation_result": "Not a franchise, legitimate service business",
      "gpt_analysis": "AI reasoning...",
      "is_franchise": false,
      "is_design_firm": false,
      "scrapedAt": "2026-02-19T19:02:00.000Z",
      "platform": "BizBuySell"
    }
  ],
  "qualifiedListings": [...], // Only qualified listings
  "stats": {
    "total": 25,
    "qualified": 18,
    "franchises": 4,
    "designFirms": 3
  },
  "timestamp": "2026-02-19T19:02:00.000Z"
}
```

### GET /api/listings
Retrieve stored qualified listings from database.

**Query Parameters:**
- `limit`: Number of listings to return (default: 50)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "listings": [...],
  "total": 150,
  "offset": 0,
  "limit": 50
}
```

### DELETE /api/listings?id={id}
Delete a specific listing from the database.

## 🛠 Troubleshooting

### Common Issues

**"OpenAI API Error"**
- Check your API key in `.env.local`
- Ensure you have credits in your OpenAI account
- Verify API key permissions

**"Supabase Connection Error"**
- Confirm all Supabase environment variables are set
- Run the database schema SQL in Supabase SQL editor
- Check RLS policies are properly configured

**"Browser Not Opening"**
- Ensure you're not in a headless environment
- Check Puppeteer dependencies are installed
- Try running with `npm run dev` locally

**"No Listings Found"**
- Website structure may have changed
- Check browser console for JavaScript errors
- Scraper includes multiple fallback selectors

### Debug Mode
Enable detailed logging by checking browser console and terminal output during scraping.

## 🚧 Future Enhancements

- **Multiple Platforms**: Add support for more deal flow platforms
- **Database Integration**: Store and track scraped listings
- **Inquiry Automation**: Send automated inquiries to listings
- **Filtering & Search**: Advanced filtering and search capabilities
- **Notifications**: Alert system for new matching listings
- **Analytics**: Track scraping performance and success rates

## 🔍 How It Works

### 🔄 **Complete AI-Powered Workflow**

1. **User Initiates Scraping**: Click button triggers enhanced scraping process

2. **Interactive Browser Automation**: 
   - Puppeteer launches visible Chrome browser with dev tools
   - Navigates to specific BizBuySell service business URL with filters
   - Handles popups, cookie banners automatically
   - Extracts detailed listing information (title, price, location, industry, description)

3. **AI-Powered Evaluation**:
   - Each listing sent to ChatGPT API for analysis
   - AI evaluates if business is a franchise or design firm
   - Provides reasoning and recommendation
   - Uses fallback keyword analysis if API fails

4. **Smart Filtering & Storage**:
   - Only qualified listings (non-franchise, non-design) stored in Supabase
   - Duplicate prevention using URL as unique identifier
   - Full audit trail with AI analysis results

5. **Real-time Dashboard Updates**:
   - Live stats showing qualified vs filtered counts
   - Color-coded results for immediate visual feedback
   - Dual-tab interface for scrape results vs stored database

6. **Database Management**:
   - PostgreSQL database via Supabase
   - Full CRUD operations on stored listings
   - Automatic timestamps and metadata tracking

### 🧠 **AI Evaluation Logic**
```typescript
// ChatGPT analyzes each listing for:
{
  "isFranchise": boolean,     // Detects franchise keywords, brand names
  "isDesignFirm": boolean,    // Identifies creative/design businesses  
  "analysis": string,         // AI reasoning explanation
  "shouldStore": boolean      // Final recommendation
}
```

## 🛡 Important Notes

- **Respectful Scraping**: The scraper includes appropriate delays and headers
- **Error Handling**: Comprehensive error handling and fallback mechanisms
- **Demo Mode**: Shows demo listings if scraping encounters issues
- **Rate Limiting**: Built-in protections to avoid overwhelming target sites

## 📄 License

This project is for educational and personal use. Please respect the terms of service of the platforms being scraped.

---

**Ready to discover your next business opportunity!** 🎯