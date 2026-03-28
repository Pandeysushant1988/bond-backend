const fetch = require("node-fetch");

async function parseMofCsv(text) {
  const byDate = {};
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 3) return byDate;
  const wanted = ["1Y","2Y","3Y","5Y","7Y","10Y","20Y","30Y"];
  const header = lines[1].split(",").map(h => h.trim());
  const colMap = {};
  header.forEach((col, idx) => { if (wanted.includes(col)) colMap[idx] = col; });
  for (const line of lines.slice(2)) {
    const cols = line.split(",").map(c => c.trim());
    if (!cols[0] || !cols[0].includes("/")) continue;
    const date = cols[0].replace(/\//g, "-");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const yields = {};
    Object.entries(colMap).forEach(([idx, tenor]) => {
      const v = cols[+idx];
      if (v && v !== "-" && v !== "" && !isNaN(+v)) yields[tenor] = +v;
    });
    if (Object.keys(yields).length >= 4) byDate[date] = yields;
  }
  return byDate;
}

async function fetchMofUrl(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 BondYieldApp/1.0" } });
    if (!res.ok) { console.warn("JGB " + url + ": HTTP " + res.status); return {}; }
    return parseMofCsv(await res.text());
  } catch(e) { console.warn("JGB error: " + e.message); return {}; }
}

async function fetchJGB() {
  const base = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate";
  const current = await fetchMofUrl(base + "/jgbcme.csv");
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const hist1 = await fetchMofUrl(base + "/data/jgbcm_" + fy + ".csv");
  const hist2 = await fetchMofUrl(base + "/data/jgbcm_" + (fy - 1) + ".csv");
  const byDate = { ...hist2, ...hist1, ...current };
  console.log("JGB: loaded " + Object.keys(byDate).length + " days from MOF");
  return byDate;
}

module.exports = { fetchJGB };
