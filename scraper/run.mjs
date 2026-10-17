// Election night scraper: state results + early-voting turnout -> site/data/results.json, turnout.json
//   node scraper/run.mjs                          one pass
//   node scraper/run.mjs --loop=350 --every=120   repeat every 2 minutes for ~6 hours (election night)
//   node scraper/run.mjs --og                     also render site/og.png (the image X shows for the link)
//   node scraper/run.mjs --from=dir --out=dir     read saved state files instead of the live site (tests)
import fs from 'node:fs';
import path from 'node:path';
import { ELECTION, RACES, COUNTY_SOURCES } from './config.mjs';
import { openClient, findElectionId, fetchResults, parseResults, fetchTurnout, fetchTurnoutDaily, parseTurnout } from './civix.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const DATA = args.out ? new URL('file://' + path.resolve(args.out) + '/') : new URL('../site/data/', import.meta.url);
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const readJSON = (name, fallback) => { try { return JSON.parse(fs.readFileSync(new URL(name, DATA), 'utf8')); } catch { return fallback; } };
// Writes only when the numbers changed (ignoring timestamps), so quiet passes don't commit or redeploy.
let changed = false;
const strip = o => JSON.stringify(o, (k, v) => (k === 'updated' || k === 'stateUpdated' ? undefined : v));
const writeJSON = (name, obj) => {
  if (strip(readJSON(name, null)) === strip(obj)) return false;
  const tmp = new URL(name + '.tmp', DATA); fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, new URL(name, DATA));
  changed = true; return true;
};
const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
const fromFile = name => JSON.parse(fs.readFileSync(path.join(args.from, name), 'utf8'));

const withPhoto = ({ id, name, party, photoCredit, photoPos }) => {
  const photo = ['jpg', 'jpeg', 'png', 'webp'].map(x => `img/${id}.${x}`).find(f => fs.existsSync(new URL(`../site/${f}`, import.meta.url)));
  return photo ? { id, name, party, photo, ...(photoPos ? { photoPos } : {}), ...(photoCredit ? { photoCredit } : {}) } : { id, name, party };
};
let client = null;
async function getClient() { if (!client) client = await openClient(log); return client; }

// ---------- results ----------
async function scrapeResults(prev) {
  let parsed;
  if (args.from) {
    const countyInfo = fromFile('countyInfo.json');
    const home = fs.existsSync(path.join(args.from, 'home.json')) ? fromFile('home.json') : null;
    parsed = parseResults({ countyInfo, home }, RACES);
  } else {
    const c = await getClient();
    const id = await findElectionId(c, ELECTION);
    parsed = parseResults(await fetchResults(c, id), RACES);
    log(`  state feed: election ${id}, ${Object.keys(parsed.registered).length} counties` + (parsed.status?.lastUpdated ? `, state updated ${parsed.status.lastUpdated}` : ''));
  }
  const sources = [{ id: 'state', races: parsed.races }];

  // Optional county sites (generic browser capture).
  for (const src of COUNTY_SOURCES) {
    try {
      const { capture } = await import('./capture.mjs');
      const { extract } = await import('./extract.mjs');
      const ex = extract(await capture({ ...src, kind: 'county' }, { raceMatchers: RACES.map(r => r.match), log }), RACES);
      for (const r of Object.values(ex)) { const own = r.counties[src.fips] || r.state; r.counties = own ? { [src.fips]: own } : {}; }
      sources.push({ id: src.id, races: ex });
    } catch (e) { log(`  ${src.id} failed: ${e.message}`); }
  }

  const now = new Date().toISOString();
  const races = RACES.map(cfg => {
    const old = prev?.races?.find(r => r.id === cfg.id);
    const counties = {};
    for (const s of sources) {
      for (const [fips, e] of Object.entries(s.races[cfg.id]?.counties || {})) {
        const total = sum(e.votes);
        if (!counties[fips] || total > counties[fips].total) counties[fips] = { votes: e.votes, total, reporting: e.reporting, src: s.id };
      }
    }
    // A county never goes backwards because one read came back short; keep the better number.
    for (const [fips, o] of Object.entries(old?.counties || {})) if (!counties[fips] || counties[fips].total < o.total * 0.98) counties[fips] = o;
    for (const [f, c] of Object.entries(counties)) if (!c.total) delete counties[f];   // keep the file small before results

    const votes = Object.fromEntries(cfg.candidates.map(c => [c.id, 0]));
    for (const c of Object.values(counties)) for (const [k, v] of Object.entries(c.votes)) votes[k] = (votes[k] || 0) + v;
    const total = sum(votes);
    const reporting = parsed.status?.polling?.total
      ? { done: parsed.status.polling.done, total: parsed.status.polling.total, unit: 'polling locations' }
      : { done: Object.keys(counties).length, total: 254, unit: 'counties' };
    const history = [...(old?.history || [])];
    if (total > 0 && history.at(-1)?.total !== total) {
      history.push({ t: now, total, pctIn: Math.round(reporting.done / reporting.total * 1000) / 10,
        pct: Object.fromEntries(Object.entries(votes).map(([k, v]) => [k, Math.round(v / total * 1000) / 10])) });
    }
    return { id: cfg.id, title: cfg.title, candidates: cfg.candidates.map(withPhoto),
      statewide: { votes, total, reporting }, counties, history };
  });

  const problems = [];
  for (const r of races) {
    const old = prev?.races?.find(x => x.id === r.id);
    if (old?.statewide?.total > 0 && r.statewide.total < old.statewide.total * 0.97) problems.push(`${r.id}: statewide total fell from ${old.statewide.total} to ${r.statewide.total}`);
    if (Object.keys(r.counties).length > 254) problems.push(`${r.id}: more than 254 counties`);
  }
  if (problems.length) { log('NOT publishing, data looks wrong:', problems.join('; ')); return; }

  const live = races.some(r => r.statewide.total > 0);
  const demo = live ? [] : (prev?.races || []).filter(r => r.demo);   // the 2024 replay tab leaves once real votes arrive
  writeJSON('results.json', { updated: now, stateUpdated: parsed.status?.lastUpdated || null, election: ELECTION, races: [...races, ...demo] });
  for (const r of races) log(`results ${r.id}: ${r.statewide.total.toLocaleString()} votes, ${r.statewide.reporting.done}/${r.statewide.reporting.total} ${r.statewide.reporting.unit}`);
}

// ---------- turnout ----------
async function scrapeTurnout() {
  let raw, dates = [], daily = [];
  const prevT = readJSON('turnout.json', {});
  if (args.from) {
    const f = path.join(args.from, 'evr.json'); raw = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    const fd = path.join(args.from, 'daily.json'); if (fs.existsSync(fd)) ({ dates, daily } = JSON.parse(fs.readFileSync(fd, 'utf8')));
  } else {
    const c = await getClient(); const id = await findElectionId(c, ELECTION);
    const d = await fetchTurnoutDaily(c, id, prevT.daily || []);
    dates = d.dates; daily = d.daily;
    raw = d.latest || await fetchTurnout(c, id);
  }
  if (!raw) { log('turnout: nothing posted yet'); return; }
  const { asOf, counties } = parseTurnout(raw);
  const vals = Object.values(counties);
  const s = k => vals.reduce((a, c) => a + (c[k] || 0), 0);
  if (!daily.length && asOf) daily = [{ date: asOf, inPerson: s('inPerson'), mail: s('mail'), total: s('total') }];
  writeJSON('turnout.json', { updated: new Date().toISOString(), asOf, label: 'Early voting turnout',
    statewide: { inPerson: s('inPerson'), mail: s('mail'), total: s('total'), registered: s('registered') },
    dates: dates.length ? dates : (prevT.dates || []), daily, counties });
  log(`turnout (as of ${asOf}): ${s('total').toLocaleString()} voted early of ${s('registered').toLocaleString()} registered, ${vals.length} counties`);
}

// ---------- social card ----------
async function renderOg(card = args.card || RACES[0].id, file = 'og.png', markets = null) {
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', [new URL('../scripts/build-site.mjs', import.meta.url).pathname]);
  const { chromium } = await import('playwright');
  const http = await import('node:http');
  const root = new URL('../dist/', import.meta.url).pathname;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/markets')) {   // stands in for the site's Pages Function
      res.writeHead(markets ? 200 : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify(markets || { races: [] })); return;
    }
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    fs.readFile(p, (err, buf) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); res.end(buf); });
  }).listen(0);
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`http://localhost:${server.address().port}/index.html?card=${card}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: new URL(`../site/${file}`, import.meta.url).pathname, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await b.close(); server.close();
  log(`rendered site/${file}`);
}

// Markets share card: re-rendered once a day, or sooner (at most every 3 hours) when a price moves 2¢ or more.
// Each render is a commit and a site rebuild, so this stays well inside the host's monthly build limit.
// It pauses from 6 p.m. CT on election night through Nov. 6, when builds are saved for results.
async function maybeRenderMarketsCard() {
  const now = Date.now();
  if (now >= Date.parse('2026-11-03T18:00:00-06:00') && now < Date.parse('2026-11-07T00:00:00-06:00')) return;
  const { fetchMarkets } = await import('../lib/markets.mjs');
  let m;
  try { m = await fetchMarkets(fetch, now); } catch (e) { log('markets failed:', e.message); return; }
  const prices = Object.fromEntries(m.races.flatMap(r => r.candidates.map(c => [c.id, c.price])));
  if (!Object.keys(prices).length) return;
  const day = new Date(now).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
  const last = readJSON('markets-card.json', null);
  const moved = last ? Math.max(...Object.entries(prices).map(([k, p]) => Math.abs(p - (last.prices?.[k] ?? -1)))) : 1;
  const due = !last || !fs.existsSync(new URL('../site/og-markets.png', import.meta.url)) || last.day !== day || (moved >= 0.02 && now - Date.parse(last.rendered) >= 3 * 3600e3);
  if (!due) return;
  await renderOg('markets', 'og-markets.png', m);
  fs.writeFileSync(new URL('markets-card.json', DATA), JSON.stringify({ rendered: new Date(now).toISOString(), day, prices }));
}

async function once() {
  const prev = readJSON('results.json', null);
  try { await scrapeResults(prev); } catch (e) { log('results failed:', e.message); }
  try { await scrapeTurnout(); } catch (e) { log('turnout failed:', e.message); }
  if (args.og && (changed || !fs.existsSync(new URL('../site/og.png', import.meta.url)))) await renderOg();
  changed = false;
  if (args.og && !args.from) try { await maybeRenderMarketsCard(); } catch (e) { log('markets card failed:', e.message); }
}

// --every=auto: every 30 minutes normally, every 2 minutes from 6:45 p.m. CT on election night until 6 a.m.,
// then every 10 minutes while late ballots are counted through Nov. 6.
const autoEvery = (now = Date.now()) => {
  const night = Date.parse('2026-11-03T18:45:00-06:00'), morning = Date.parse('2026-11-04T06:00:00-06:00'), late = Date.parse('2026-11-07T00:00:00-06:00');
  return now >= night && now < morning ? 120 : now >= morning && now < late ? 600 : 1800;
};
const loopMin = +args.loop || 0, end = Date.now() + loopMin * 60000;
const everySec = () => (args.every === 'auto' ? autoEvery() : +args.every || 120);
try {
  while (true) {
    const t0 = Date.now();
    try { await once(); } catch (e) { log('pass failed:', e.message); }
    if (!loopMin) break;
    if (args.onpass) { const { execSync } = await import('node:child_process'); try { execSync(args.onpass, { stdio: 'inherit', shell: '/bin/bash' }); } catch (e) { log('publish step failed:', e.message); } }
    const wait = Math.max(5000, everySec() * 1000 - (Date.now() - t0));
    if (Date.now() + wait > end) break;
    await new Promise(r => setTimeout(r, wait));
  }
} finally { if (client) await client.close(); }
