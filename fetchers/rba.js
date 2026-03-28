const fetch = require("node-fetch");

// RBA Table F2 — Capital Market Yields, Government Bonds, Daily
// Correct URL confirmed March 2026

async function fetchRBA() {
  const URLS = [
    "https://www.rba.gov.au/statistics/tables/csv/f2.csv",
    "https://www.rba.gov.au/statistics/tables/csv/f2-data.csv",
  ];

  for (const url of URLS) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "BondYieldApp/1.0" } });
      if (!res.ok) { console.warn(`RBA ${url}: HTTP ${res.status}`); continue; }

      const text = await res.text();
      const lines = text.split("\n");
      const byDate = {};

      // RBA CSV: first ~10 rows are metadata, then dates start
      // Row 1 (index 0): titles
      // Row 2 (index 1): descriptions — contains "2 year", "3 year" etc
      // Data rows: DD-Mon-YYYY format

      const descRow = lines[1] ? lines[1].split(",") : [];
      const colMap = {};
      descRow.forEach((cell, idx) => {
        const c = cell.toLowerCase();
        if (c.includes("2 year") && c.includes("government")) colMap[idx] = "2Y";
        if (c.includes("3 year") && c.includes("government")) colMap[idx] = "3Y";
        if (c.includes("5 year") && c.includes("government")) colMap[idx] = "5Y";
        if (c.includes("10 year") && c.includes("government")) colMap[idx] = "10Y";
      });

      const months = {
        jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
        jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"
      };

      for (const line of lines) {
        const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
        const match = cols[0].match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
        if (!match) continue;

        const date = `${match[3]}-${months[match[2].toLowerCase()] || "01"}-${match[1]}`;
        const yields = {};
        Object.entries(colMap).forEach(([idx, tenor]) => {
          const v = cols[parseInt(idx)];
          if (v && v !== "" && !isNaN(parseFloat(v))) yields[tenor] = parseFloat(v);
        });

        if (Object.keys(yields).length > 0) byDate[date] = yields;
      }

      if (Object.keys(byDate).length > 0) {
        console.log(`RBA: loaded ${Object.keys(byDate).length} days from ${url}`);
        return byDate;
      }
    } catch (err) {
      console.warn(`RBA error: ${err.message}`);
    }
  }
  return {};
}

module.exports = { fetchRBA };
