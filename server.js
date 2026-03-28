// Bond Yield Backend Server
// Fetches real sovereign bond yield curves from official free sources:
//   US Treasuries  → FRED API (Federal Reserve)
//   JGB            → Japan Ministry of Finance CSV
//   India G-Sec    → FRED/OECD (monthly 10Y, curve estimated) + FBIL if available
//   ACGB (Aust)    → Reserve Bank of Australia Table F2
//   Bund (EUR)     → ECB Data Portal API
//   XCcy basis     → CIP-implied approximation from FRED rates

require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const NodeCache = require("node-cache");

const { fetchUS }   = require("./fetchers/us");
const { fetchJGB }  = require("./fetchers/jgb");
const { fetchRBA }  = require("./fetchers/rba");
const { fetchEUR }  = require("./fetchers/ecb");
const { fetchRBI, DATA_QUALITY: INDIA_QUALITY } = require("./fetchers/rbi");
const { fetchXCcy } = require("./fetchers/xccy");

const app  = express();
const PORT = process.env.PORT || 3000;
const FRED_KEY = process.env.FRED_API_KEY;

if (!FRED_KEY) {
  console.error("❌ FRED_API_KEY missing in .env — US Treasury and India data will fail");
  console.error("   Get a free key at: https://fred.stlouisfed.org/docs/api/api_key.html");
}

// ── Cache config ─────────────────────────────────────────────────────────────
// Bond data doesn't change intraday (published end-of-day).
// Cache for 4 hours during market hours, 12 hours overnight.
const cache = new NodeCache({
  stdTTL: 4 * 60 * 60,     // 4 hours default
  checkperiod: 60 * 10,    // check every 10 min
  useClones: false,
});

app.use(cors());
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    cache_keys: cache.keys(),
    fred_key_configured: !!FRED_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ── Data sources info ─────────────────────────────────────────────────────────
app.get("/sources", (req, res) => {
  res.json({
    bonds: {
      US: {
        label: "US Treasury",
        source: "Federal Reserve via FRED API",
        url: "https://fred.stlouisfed.org",
        series: "DGS3MO, DGS6MO, DGS1, DGS2, DGS3, DGS5, DGS7, DGS10, DGS20, DGS30",
        frequency: "daily",
        latency: "published next business morning",
        quality: "real",
        license: "public domain, free"
      },
      JGB: {
        label: "Japanese Government Bonds",
        source: "Japan Ministry of Finance",
        url: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/",
        frequency: "daily",
        latency: "published same day",
        quality: "real",
        license: "public domain, free",
        note: "3M and 6M tenors not published by MOF — those will show as N/A"
      },
      IGB: {
        label: "India G-Sec",
        source: "FRED/OECD (10Y monthly) + curve shape estimation",
        url: "https://fred.stlouisfed.org/series/IRLTLT01INM156N",
        frequency: "monthly (10Y anchor), other tenors estimated",
        quality: "estimated",
        warning: INDIA_QUALITY.warning,
        betterSource: "FBIL (paid), NSE bond API (broker required)"
      },
      AUD: {
        label: "Australian Commonwealth Govt Bonds",
        source: "Reserve Bank of Australia — Table F2",
        url: "https://www.rba.gov.au/statistics/tables/",
        frequency: "daily",
        latency: "published same day",
        quality: "real",
        license: "public domain, free",
        note: "3M/6M/1Y not in RBA F2 — cash rate used as proxy for short end"
      },
      EUR: {
        label: "Euro Area Govt Bonds (ECB yield curve)",
        source: "ECB Data Portal API",
        url: "https://data-api.ecb.europa.eu",
        dataset: "YC — yield curve, all issuers, par yield, Svensson model",
        frequency: "daily (TARGET business days)",
        latency: "noon CET same day",
        quality: "real",
        license: "public domain, free"
      }
    },
    xccy: {
      JPYUSD: {
        label: "JPY/USD Cross-Currency Basis",
        method: "CIP deviation approximation",
        inputs: ["FRED DGS10 (USD 10Y)", "FRED IRLTLT01JPM156N (JPY 10Y, monthly)"],
        warning: "Approximate ±10-20bps vs quoted market. Not OTC xccy swap quotes.",
        exactSource: "Bloomberg VCUB, Refinitiv, or broker runs (paid)"
      },
      AUDUSD: {
        label: "AUD/USD Cross-Currency Basis",
        method: "CIP deviation approximation",
        inputs: ["FRED DGS10 (USD 10Y)", "FRED IRLTLT01AUM156N (AUD 10Y, monthly)"],
        warning: "Approximate ±10-20bps vs quoted market. Not OTC xccy swap quotes.",
        exactSource: "Bloomberg VCUB, Refinitiv, or broker runs (paid)"
      }
    }
  });
});

// ── Generic cached fetch wrapper ──────────────────────────────────────────────
async function getCached(cacheKey, fetchFn, ttlOverride) {
  const cached = cache.get(cacheKey);
  if (cached) {
    return { data: cached, fromCache: true };
  }
  const data = await fetchFn();
  cache.set(cacheKey, data, ttlOverride || 4 * 60 * 60);
  return { data, fromCache: false };
}

// ── Bonds endpoint ─────────────────────────────────────────────────────────────
// GET /bonds?country=US&from=2025-01-01&to=2025-12-31
// country: US | JGB | IGB | AUD | EUR | all
// Returns: { country, data: { "YYYY-MM-DD": { "3M": 4.32, "10Y": 4.28, ... } }, metadata }
app.get("/bonds", async (req, res) => {
  const country = (req.query.country || "all").toUpperCase();
  const fromDate = req.query.from || daysAgo(400);
  const toDate   = req.query.to   || today();

  try {
    const countries = country === "ALL"
      ? ["US", "JGB", "IGB", "AUD", "EUR"]
      : [country];

    const results = {};
    const metadata = {};

    await Promise.all(countries.map(async (c) => {
      try {
        let rawData;
        switch (c) {
          case "US":
            ({ data: rawData } = await getCached("bonds_US", () => fetchUS(FRED_KEY)));
            metadata.US = { source: "FRED (Federal Reserve)", quality: "real", frequency: "daily" };
            break;
          case "JGB":
            ({ data: rawData } = await getCached("bonds_JGB", fetchJGB));
            metadata.JGB = { source: "Japan MoF", quality: "real", frequency: "daily", note: "3M/6M not published" };
            break;
          case "IGB":
            ({ data: rawData } = await getCached("bonds_IGB", () => fetchRBI(FRED_KEY)));
            metadata.IGB = { source: "FRED/OECD", quality: "estimated", warning: INDIA_QUALITY.warning };
            break;
          case "AUD":
            ({ data: rawData } = await getCached("bonds_AUD", fetchRBA));
            metadata.AUD = { source: "RBA Table F2", quality: "real", frequency: "daily", note: "2Y-15Y tenors" };
            break;
          case "EUR":
            ({ data: rawData } = await getCached("bonds_EUR", fetchEUR));
            metadata.EUR = { source: "ECB Data Portal", quality: "real", frequency: "daily (TARGET days)" };
            break;
          default:
            return;
        }

        // Filter by date range
        results[c] = Object.fromEntries(
          Object.entries(rawData || {})
            .filter(([date]) => date >= fromDate && date <= toDate)
            .sort(([a], [b]) => a.localeCompare(b))
        );

      } catch (err) {
        console.error(`Error fetching ${c}: ${err.message}`);
        results[c] = null;
        metadata[c] = { error: err.message };
      }
    }));

    res.json({
      countries,
      from: fromDate,
      to: toDate,
      results,
      metadata,
      cached_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Bonds endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── XCcy endpoint ─────────────────────────────────────────────────────────────
// GET /xccy?pair=JPYUSD&from=2025-01-01
// pair: JPYUSD | AUDUSD | all
app.get("/xccy", async (req, res) => {
  const pair     = (req.query.pair || "all").toUpperCase();
  const fromDate = req.query.from || daysAgo(400);
  const toDate   = req.query.to   || today();

  try {
    const { data: xccyData } = await getCached(
      "xccy_all",
      () => fetchXCcy(FRED_KEY),
      6 * 60 * 60  // xccy refreshes every 6h (monthly inputs)
    );

    const pairs = pair === "ALL" ? ["JPYUSD", "AUDUSD"] : [pair];
    const results = {};

    pairs.forEach(p => {
      const raw = xccyData[p] || {};
      results[p] = Object.fromEntries(
        Object.entries(raw)
          .filter(([date]) => date >= fromDate && date <= toDate)
          .sort(([a], [b]) => a.localeCompare(b))
      );
    });

    res.json({
      pairs,
      from: fromDate,
      to: toDate,
      results,
      metadata: xccyData.metadata,
      cached_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error("XCcy endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Latest (today's) data ──────────────────────────────────────────────────────
// GET /latest — returns most recent available date for all instruments
app.get("/latest", async (req, res) => {
  try {
    const [
      { data: usData },
      { data: jgbData },
      { data: igbData },
      { data: audData },
      { data: eurData },
      { data: xccyData },
    ] = await Promise.all([
      getCached("bonds_US",  () => fetchUS(FRED_KEY)),
      getCached("bonds_JGB", fetchJGB),
      getCached("bonds_IGB", () => fetchRBI(FRED_KEY)),
      getCached("bonds_AUD", fetchRBA),
      getCached("bonds_EUR", fetchEUR),
      getCached("xccy_all",  () => fetchXCcy(FRED_KEY), 6 * 60 * 60),
    ]);

    const latestDate = (data) => data ? Object.keys(data).sort().pop() : null;
    const latestData = (data) => {
      const d = latestDate(data);
      return d ? { date: d, yields: data[d] } : null;
    };

    const prevDate = (data, latestD) => {
      if (!data || !latestD) return null;
      const dates = Object.keys(data).sort();
      const idx = dates.indexOf(latestD);
      return idx > 0 ? { date: dates[idx - 1], yields: data[dates[idx - 1]] } : null;
    };

    const usLatest  = latestData(usData);
    const jgbLatest = latestData(jgbData);
    const igbLatest = latestData(igbData);
    const audLatest = latestData(audData);
    const eurLatest = latestData(eurData);

    const jpyLatestD  = latestDate(xccyData?.JPYUSD);
    const audXLatestD = latestDate(xccyData?.AUDUSD);

    res.json({
      bonds: {
        US:  { today: usLatest,  prev: prevDate(usData,  usLatest?.date)  },
        JGB: { today: jgbLatest, prev: prevDate(jgbData, jgbLatest?.date) },
        IGB: { today: igbLatest, prev: prevDate(igbData, igbLatest?.date) },
        AUD: { today: audLatest, prev: prevDate(audData, audLatest?.date) },
        EUR: { today: eurLatest, prev: prevDate(eurData, eurLatest?.date) },
      },
      xccy: {
        JPYUSD: {
          today: jpyLatestD  ? { date: jpyLatestD,  basis: xccyData.JPYUSD[jpyLatestD] }  : null,
          prev:  null, // populated same way if needed
        },
        AUDUSD: {
          today: audXLatestD ? { date: audXLatestD, basis: xccyData.AUDUSD[audXLatestD] } : null,
          prev:  null,
        },
      },
      metadata: {
        xccy: xccyData?.metadata,
        IGB: INDIA_QUALITY,
      },
      fetched_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Latest endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Cache management ──────────────────────────────────────────────────────────
app.post("/cache/clear", (req, res) => {
  cache.flushAll();
  res.json({ message: "Cache cleared", timestamp: new Date().toISOString() });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏛  Bond Yield Backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Sources: http://localhost:${PORT}/sources`);
  console.log(`   Latest: http://localhost:${PORT}/latest`);
  console.log(`   Bonds:  http://localhost:${PORT}/bonds?country=US`);
  console.log(`   XCcy:   http://localhost:${PORT}/xccy?pair=JPYUSD`);
  console.log(`\n   FRED key: ${FRED_KEY ? "✅ configured" : "❌ missing — add to .env"}\n`);
});

module.exports = app;
