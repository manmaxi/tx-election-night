// Prediction-market prices for the Texas races, from Polymarket's public market data
// (Gamma API for markets, CLOB API for price history; both documented as needing no key).
// Used by the site's /api/markets function and by the scraper when it renders the markets share card.
//
// Kalshi is deliberately absent: its Developer Agreement limits API data to a member's own trading
// and bars sharing it with third parties without written permission. Robinhood's event contracts are
// mostly Kalshi's, and it has no public data feed.

export const MARKET_RACES = [
  { id: 'senate', title: 'U.S. Senate', event: 'texas-senate-election-winner', candidates: [
    { id: 'paxton', name: 'Ken Paxton', party: 'R', market: 'will-the-republicans-win-the-texas-senate-race-in-2026' },
    { id: 'talarico', name: 'James Talarico', party: 'D', market: 'will-the-democrats-win-the-texas-senate-race-in-2026' },
  ] },
  { id: 'governor', title: 'Governor', event: 'texas-governor-winner-2026', candidates: [
    { id: 'abbott', name: 'Greg Abbott', party: 'R', market: 'will-the-republicans-win-the-texas-governor-race-in-2026' },
    { id: 'hinojosa', name: 'Gina Hinojosa', party: 'D', market: 'will-the-democrats-win-the-texas-governor-race-in-2026' },
  ] },
];

// A race is shown only with real trading behind it, so a thin market can't post a misleading number.
export const MIN_VOLUME = 100000;

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const UA = { 'user-agent': 'TexasDecides/1.0 (+https://elections.singlestopmarketing.com)', accept: 'application/json' };

async function getJSON(fetchImpl, url) {
  const r = await fetchImpl(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// Price shown = Polymarket's own displayed price (midpoint), in dollars per $1 contract.
const num = v => (v == null || v === '' ? null : +v);

export async function fetchMarkets(fetchImpl = fetch, now = Date.now()) {
  const races = [];
  for (const def of MARKET_RACES) {
    const [ev] = await getJSON(fetchImpl, `${GAMMA}/events?slug=${def.event}`);
    if (!ev) continue;
    const bySlug = Object.fromEntries((ev.markets || []).map(m => [m.slug, m]));
    const candidates = [];
    for (const c of def.candidates) {
      const m = bySlug[c.market];
      if (!m || m.closed) continue;
      const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      const tokens = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds;
      let price = num(prices?.[0]);
      if (price == null) price = num(m.lastTradePrice);
      // 30 days at 3-hour steps: enough for the trend line and a 24-hour change.
      let history = [];
      try {
        const h = await getJSON(fetchImpl, `${CLOB}/prices-history?market=${tokens[0]}&interval=1m&fidelity=180`);
        history = (h.history || []).map(p => [p.t, +p.p]).filter(p => p[1] >= 0);
      } catch (_) {}
      const dayAgo = history.length ? history.reduce((best, p) => Math.abs(p[0] - (now / 1000 - 86400)) < Math.abs(best[0] - (now / 1000 - 86400)) ? p : best) : null;
      const weekAgo = history.length ? history.reduce((best, p) => Math.abs(p[0] - (now / 1000 - 7 * 86400)) < Math.abs(best[0] - (now / 1000 - 7 * 86400)) ? p : best) : null;
      candidates.push({
        id: c.id, name: c.name, party: c.party, price,
        change24h: dayAgo && price != null ? +(price - dayAgo[1]).toFixed(4) : null,
        change7d: weekAgo && price != null ? +(price - weekAgo[1]).toFixed(4) : null,
        volume: Math.round(num(m.volume) || 0),
        history: history.map(([t, p]) => [t, Math.round(p * 1000) / 1000]),
      });
    }
    const volume = Math.round(num(ev.volume) || 0);
    races.push({
      id: def.id, title: def.title, url: `https://polymarket.com/event/${def.event}`,
      volume, volume24h: Math.round(num(ev.volume24hr) || 0), enough: volume >= MIN_VOLUME && candidates.length === def.candidates.length,
      updated: ev.updatedAt || null, candidates,
    });
  }
  return { source: 'Polymarket', sourceUrl: 'https://polymarket.com', fetched: new Date(now).toISOString(), races };
}
