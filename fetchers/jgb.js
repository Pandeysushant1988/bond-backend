const fetch = require("node-fetch");

async function fetchJGB() {
  const byDate = {};
  const url = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv";
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) { console.warn("JGB HTTP " + res.status); return {}; }
    const text = await res.text();
    const lines = text.split("\n").filter(l => l.trim());
    const header = lines[1].split(",").map(h => h.trim());
    const colMap = {};
    const wanted = ["1Y","2Y","3Y","5Y","7Y","10Y","20Y","30Y"];
    header.forEach((col, idx) => { if (wanted.includes(col)) colMap[idx] = col; });
    for (const line of lines.slice(2)) {
      const cols = line.split(",").map(c => c.trim());
      if (!cols[0] || !cols[0].includes("/")) continue;
      const date = cols[0].replace(/\//g, "-");
      const yields = {};
      Object.entries(colMap).forEach(([idx, tenor]) => {
        const v = cols[+idx];
        if (v && v !== "-" && v !== "" && !isNaN(+v)) yields[tenor] = +v;
      });
      if (Object.keys(yields).length >= 4) byDate[date] = yields;
    }
    console.log("JGB: loaded " + Object.keys(byDate).length + " days from MOF");
  } catch(e) { console.warn("JGB error: " + e.message); }
  return byDate;
}

module.exports = { fetchJGB };
