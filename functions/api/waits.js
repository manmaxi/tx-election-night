// GET /api/waits  (Cloudflare Pages Function)
// Official polling-place wait times for the Line check tool, fetched from the counties at most every
// 90 seconds, cached at the edge, with the last good copy served for up to 6 hours if a county is down.
//   phase "preview": before Election Day, the final early-voting readings (labeled as such on the page).
//   phase "live":    Election Day, Nov 3, 2026 (6 a.m. to 10 p.m. CT): Election Day vote centers only.
//   phase "off":     after that; the page hides the tool.
import { fetchWaits } from '../../lib/waits.mjs';

const FRESH = 90, KEEP = 6 * 3600;
const LIVE_FROM = Date.parse('2026-11-03T06:00:00-06:00'), LIVE_TO = Date.parse('2026-11-03T22:00:00-06:00');

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default, origin = new URL(request.url).origin;
  const freshKey = new Request(origin + '/api/waits?cache=fresh'), lastKey = new Request(origin + '/api/waits?cache=last');
  const hit = await cache.match(freshKey);
  if (hit) return hit;
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${FRESH}`, 'access-control-allow-origin': '*' };
  try {
    const now = Date.now(), phase = now < LIVE_FROM ? 'preview' : now <= LIVE_TO ? 'live' : 'off';
    const d = await fetchWaits(fetch, now);
    if (!d.locations.length) throw new Error('no locations');
    const today = new Date(now).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
    const sameDay = iso => iso && new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) === today;
    const edCount = {}; for (const l of d.locations) if (l.kind === 'ED') edCount[l.county] = (edCount[l.county] || 0) + 1;
    d.phase = phase;
    d.edCount = edCount;   // Election Day vote centers already published, per county
    d.locations = phase === 'live' ? d.locations.filter(l => l.kind === 'ED' || sameDay(l.updated)) : d.locations.filter(l => l.kind === 'EV');
    const body = JSON.stringify(d);
    waitUntil(Promise.all([
      cache.put(freshKey, new Response(body, { headers })),
      cache.put(lastKey, new Response(body, { headers: { ...headers, 'cache-control': `public, max-age=${KEEP}` } })),
    ]));
    return new Response(body, { headers });
  } catch (e) {
    const last = await cache.match(lastKey);
    if (last) { const r = new Response(last.body, last); r.headers.set('x-waits', 'stale'); r.headers.set('cache-control', 'public, max-age=30'); return r; }
    return new Response(JSON.stringify({ error: 'unavailable', locations: [], counties: [] }), { status: 503, headers: { ...headers, 'cache-control': 'no-store' } });
  }
}
