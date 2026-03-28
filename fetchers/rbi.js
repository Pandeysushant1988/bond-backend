const fetch = require("node-fetch");

const CURVE_SHAPE = {
  "3M":-0.30,"6M":-0.20,"1Y":-0.10,"2Y":-0.05,"3Y":0.00,
  "5Y":0.02,"7Y":0.05,"10Y":0.00,"20Y":0.15,"30Y":0.20
};

async function fetchRBI(apiKey) {
  try {
    const start = new Date();
    start.setDate(start.getDate() - 450);
    const startStr = start.toISOString().slice(0, 10);

    const url = `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=INDIRLTLT01STM&api_key=${apiKey}&file_type=json` +
      `&observation_start=${startStr}&sort_order=asc`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error_message) throw new Error(json.error_message);

    const obs = json.observations
      .filter(o => o.value !== "." && o.value !== "")
      .map(o => ({ date: o.date, value: parseFloat(o.value) }));

    if (obs.length === 0) throw new Error("No observations returned");

    // Forward-fill monthly data into daily
    const byDate = {};
    let lastVal = null;
    let obsIdx = 0;
    const endDate = new Date();

    for (let d = new Date(startStr); d <= endDate; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const ds = d.toISOString().slice(0, 10);
      while (obsIdx < obs.length && obs[obsIdx].date <= ds) {
        lastVal = obs[obsIdx].value;
        obsIdx++;
      }
      if (lastVal !== null) {
        const yields = {};
        Object.entries(CURVE_SHAPE).forEach(([tenor, spread]) => {
          yields[tenor] = parseFloat((lastVal + spread).toFixed(3));
        });
        byDate[ds] = yields;
      }
    }
    console.log(`IGB: loaded ${Object.keys(byDate).length} days (monthly 10Y anchor)`);
    return byDate;
  } catch (err) {
    console.error(`RBI fetch failed: ${err.message}`);
    return {};
  }
}

const DATA_QUALITY = {
  warning: "India G-Sec: monthly 10Y from FRED/OECD. Other tenors estimated from curve shape. For daily data use FBIL or NSE APIs."
};

module.exports = { fetchRBI, DATA_QUALITY };
