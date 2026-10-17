// GET /api/markets  (Cloudflare Pages Function)
// Fetches Polymarket prices for the Texas races at most once a minute, caches them at the edge,
// and serves the last good copy for up to a day if Polymarket is unreachable.
// No page rebuilds are needed for prices to stay current.
import { fetchMarkets } from '../../lib/markets.mjs';

const FRESH = 60;          // seconds
const KEEP = 86400;        // last-good fallback

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const origin = new URL(request.url).origin;
  const freshKey = new Request(origin + '/api/markets?cache=fresh');
  const lastKey = new Request(origin + '/api/markets?cache=last');

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${FRESH}`, 'access-control-allow-origin': '*' };
  try {
    const data = await fetchMarkets(fetch);
    if (!data.races.length) throw new Error('no markets');
    const body = JSON.stringify(data);
    const res = new Response(body, { headers });
    waitUntil(Promise.all([
      cache.put(freshKey, new Response(body, { headers: { ...headers, 'cache-control': `public, max-age=${FRESH}` } })),
      cache.put(lastKey, new Response(body, { headers: { ...headers, 'cache-control': `public, max-age=${KEEP}` } })),
    ]));
    return res;
  } catch (e) {
    const last = await cache.match(lastKey);
    if (last) { const r = new Response(last.body, last); r.headers.set('x-markets', 'stale'); r.headers.set('cache-control', 'public, max-age=30'); return r; }
    return new Response(JSON.stringify({ error: 'unavailable', races: [] }), { status: 503, headers: { ...headers, 'cache-control': 'no-store' } });
  }
}
