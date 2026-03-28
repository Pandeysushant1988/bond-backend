// US Treasury yields via FRED API (Federal Reserve Bank of St. Louis)
// Source: https://fred.stlouisfed.org
// Free API key required — register at https://fred.stlouisfed.org/docs/api/api_key.html
// Data: Board of Governors of the Federal Reserve System, H.15 Statistical Release
// Updated: daily (business days), published next day morning

const fetch = require("node-fetch");

// FRED series IDs for each tenor
// These are the official constant-maturity Treasury yield series
const FRED_SERIES = {
  "3M":  "DGS3MO",   // 3-Month Treasury Constant Maturity
  "6M":  "DGS6MO",   // 6-Month Treasury Constant Maturity
  "1Y":  "DGS1",     // 1-Year Treasury Constant Maturity
  "2Y":  "DGS2",     // 2-Year Treasury Constant Maturity
  "3Y":  "DGS3",     // 3-Year Treasury Constant Maturity
  "5Y":  "DGS5",     // 5-Year Treasury Constant Maturity
  "7Y":  "DGS7",     // 7-Year Treasury Constant Maturity
  "10Y": "DGS10",    // 10-Year Treasury Constant Maturity
  "20Y": "DGS20",    // 20-Year Treasury Constant Maturity
  "30Y": "DGS30",    // 30-Year Treasury Constant Maturity
};

const BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

/**
 * Fetch one FRED series for the past N days
 * Returns array of { date: "YYYY-MM-DD", value: number } sorted ascending
 */
async function fetchFredSeries(seriesId, apiKey, days = 400) {
  const observationStart = daysAgo(days);
  const url = `${BASE_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json` +
              `&observation_start=${observationStart}&sort_order=asc`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);

  const json = await res.json();
  if (json.error_code) throw new Error(`FRED ${seriesId}: ${json.error_message}`);

  return json.observations
    .filter(o => o.value !== "." && o.value !== "")  // FRED uses "." for missing days
    .map(o => ({ date: o.date, value: parseFloat(o.value) }));
}

/**
 * Fetch all US Treasury tenors and reshape into date-keyed object:
 * { "2024-01-15": { "3M": 5.27, "6M": 5.18, ... }, ... }
 */
async function fetchUS(apiKey) {
  const tenors = Object.keys(FRED_SERIES);

  // Fetch all tenors in parallel
  const results = await Promise.all(
    tenors.map(tenor => fetchFredSeries(FRED_SERIES[tenor], apiKey))
  );

  // Build date-keyed map
  const byDate = {};
  tenors.forEach((tenor, i) => {
    results[i].forEach(({ date, value }) => {
      if (!byDate[date]) byDate[date] = {};
      byDate[date][tenor] = value;
    });
  });

  // Only return dates that have at least 8 of 10 tenors
  // (some tenors like 20Y were discontinued and reintroduced)
  return Object.fromEntries(
    Object.entries(byDate).filter(([, vals]) => Object.keys(vals).length >= 8)
  );
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

module.exports = { fetchUS };
