# Bond Yield Backend

Real sovereign bond yield curve data for the iOS app.
No hardcoded values. No simulated data.

---

## Data Sources

| Market | Source | Free? | Quality | Frequency |
|--------|--------|-------|---------|-----------|
| 🇺🇸 US Treasuries | FRED API (Federal Reserve) | ✅ Free | Real | Daily |
| 🇯🇵 JGB | Japan Ministry of Finance CSV | ✅ Free | Real | Daily |
| 🇮🇳 India G-Sec | FRED/OECD (10Y anchor) | ✅ Free | ⚠️ Estimated | Monthly 10Y |
| 🇦🇺 ACGB (Aust) | RBA Table F2 | ✅ Free | Real | Daily |
| 🇪🇺 Bund (EUR) | ECB Data Portal API | ✅ Free | Real | Daily |
| 🔄 XCcy Basis | CIP approximation from FRED | ✅ Free | ⚠️ Approximate ±10-20bps | Daily |

### Important caveats

**India G-Sec**: The only free source for India yield data on FRED is monthly 10Y from OECD/IMF.
Other tenors are estimated using historical curve shape. For real data, you need FBIL subscription
(₹50,000/year) or an NSE/BSE broker API that provides G-Sec data (Zerodha, Dhan).

**XCcy Basis**: True cross-currency basis swap quotes are OTC and not available free.
We compute a CIP-implied approximation using FRED interest rate differentials.
Sign and rough magnitude will be correct, but exact bps can differ from quoted market by ±10-20bps.
For exact levels: Bloomberg VCUB screen or broker runs.

---

## Setup

### 1. Get a free FRED API key

1. Go to https://fred.stlouisfed.org/docs/api/api_key.html
2. Register (takes 2 minutes, no credit card)
3. Copy your API key

### 2. Configure

```bash
cp .env.example .env
# Edit .env and add your FRED_API_KEY
```

### 3. Install and run

```bash
npm install
npm start
```

Server starts on http://localhost:3000

---

## API Endpoints

### GET /health
Check server status and cache state.

### GET /sources
Full description of every data source, series IDs, data quality flags.

### GET /latest
Today's yields + previous business day for all 5 bond markets and both xccy pairs.
**This is the main endpoint the iOS app uses.**

Response:
```json
{
  "bonds": {
    "US": {
      "today": { "date": "2026-03-27", "yields": { "3M": 4.31, "10Y": 4.28, ... } },
      "prev":  { "date": "2026-03-26", "yields": { "3M": 4.33, "10Y": 4.30, ... } }
    },
    ...
  },
  "xccy": {
    "JPYUSD": {
      "today": { "date": "2026-03-27", "basis": { "1Y": -32, "5Y": -55, "10Y": -63 } }
    }
  },
  "metadata": { ... }
}
```

### GET /bonds?country=US&from=2025-01-01&to=2026-03-27
Historical yield curve data for a given country and date range.
country: `US` | `JGB` | `IGB` | `AUD` | `EUR` | `all`

### GET /xccy?pair=JPYUSD&from=2025-01-01
Historical xccy basis for a pair.
pair: `JPYUSD` | `AUDUSD` | `all`

### POST /cache/clear
Force refresh all cached data.

---

## Caching

- Bond data: cached 4 hours (data only changes once per business day)
- XCcy data: cached 6 hours (inputs are monthly, so changes rarely)
- On first request after startup, fetches live from all APIs (~3-5 seconds)
- Subsequent requests return from cache instantly

---

## Deploy to Railway (free tier)

1. Push this folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variable: `FRED_API_KEY=your_key`
4. Railway gives you a public URL (e.g. `https://bond-yield-backend.railway.app`)
5. Update the iOS app's `BASE_URL` constant to point to your Railway URL

## Deploy to Render (free tier)

1. Push to GitHub
2. Go to https://render.com → New Web Service → Connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add env var: `FRED_API_KEY=your_key`

---

## iOS App Integration

In `BondYieldsApp.swift`, change:

```swift
let BASE_URL = "https://your-backend.railway.app"
```

Then call `/latest` on app launch and `/bonds?country=X&from=...` for historical data.

---

## Known Gaps & Upgrade Path

| Gap | Free workaround | Paid solution |
|-----|----------------|---------------|
| India G-Sec daily curve | Not available free | FBIL API (₹50k/yr) |
| JGB 3M/6M | Not published by MoF | Bloomberg/Refinitiv |
| Exact XCcy basis | CIP approximation | Bloomberg VCUB |
| Intraday updates | End-of-day only | Bloomberg B-PIPE |
