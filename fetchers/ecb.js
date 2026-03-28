const fetch = require("node-fetch");

const TENOR_CODES = {
  "3M":"SR_3M","6M":"SR_6M","1Y":"SR_1Y","2Y":"SR_2Y","3Y":"SR_3Y",
  "5Y":"SR_5Y","7Y":"SR_7Y","10Y":"SR_10Y","20Y":"SR_20Y","30Y":"SR_30Y",
};

async function fetchECBSeries(tenorCode, startDate) {
  const key = `B.U2.EUR.4F.G_N_A.SV_C_YM.${tenorCode}`;
  const url = `https://data-api.ecb.europa.eu/service/data/YC/${key}?startPeriod=${startDate}&format=csvdata`;
  try {
    const res = await fetch(url, { headers: { "Accept":"text/csv","User-Agent":"BondYieldApp/1.0" }});
    if (!res.ok) { console.warn(`ECB ${tenorCode}: HTTP ${res.status}`); return []; }
    const text = await res.text();
    const lines = text.split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].split(",");
    const timeIdx = header.indexOf("TIME_PERIOD");
    const valIdx  = header.indexOf("OBS_VALUE");
    if (timeIdx === -1 || valIdx === -1) return [];
    return lines.slice(1).map(line => {
      const cols = line.split(",");
      return { date: cols[timeIdx]?.trim(), value: parseFloat(cols[valIdx]?.trim()) };
    }).filter(r => r.date && !isNaN(r.value) && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  } catch(err) { console.warn(`ECB ${tenorCode}: ${err.message}`); return []; }
}

async function fetchEUR() {
  const d = new Date(); d.setDate(d.getDate()-420);
  const start = d.toISOString().slice(0,10);
  const tenors = Object.keys(TENOR_CODES);
  const results = await Promise.all(tenors.map(t => fetchECBSeries(TENOR_CODES[t], start)));
  const byDate = {};
  tenors.forEach((tenor,i) => {
    results[i].forEach(({date,value}) => {
      if (!byDate[date]) byDate[date]={};
      byDate[date][tenor]=value;
    });
  });
  return Object.fromEntries(Object.entries(byDate).filter(([,v])=>Object.keys(v).length>=5));
}

module.exports = { fetchEUR };
