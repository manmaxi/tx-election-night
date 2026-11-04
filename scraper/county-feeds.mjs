// Big counties' own results feeds. Tonight (Nov 3, 2026) the state's feed ran hours behind the
// largest counties, which post early votes on their own sites first. For each county the scraper keeps
// whichever source has counted more ballots, so the state's numbers take over again once they catch up.
//   Harris:  app.harrisvotes.com results app -> appfiles.harrisvotes.com/.../Data/{code}/resultsbyballot.json
//   Clarity: results.enr.clarityelections.com/{path}/current_ver.txt -> /{ver}/json/en/summary.json (Dallas, Tarrant)
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; TexasDecides/1.0; +https://elections.singlestopmarketing.com)', accept: 'application/json,text/plain,*/*' };
export const COUNTY_FEEDS = [
  { id: 'harris', fips: '48201', name: 'Harris', kind: 'harris', url: 'https://appfiles.harrisvotes.com/harrisvotes/prd/Data/1126/resultsbyballot.json' },
  { id: 'dallas', fips: '48113', name: 'Dallas', kind: 'clarity', path: 'TX/Dallas/126485' },
  { id: 'tarrant', fips: '48439', name: 'Tarrant', kind: 'clarity', path: 'TX/Tarrant/127297' },
];
// Contest titles differ by county ("United States Senator", "U. S. Senator (Vote for 1)").
const TITLE = { senate: /^(U\.?\s?S\.?|UNITED STATES)\s+SENATOR\b/i, governor: /^GOVERNOR\b/i };
const clean = t => String(t || '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

function tally(cfg, names, votes) {
  const out = Object.fromEntries(cfg.candidates.map(c => [c.id, 0]));
  names.forEach((n, i) => { const hit = cfg.candidates.find(c => c.match && c.match.test(n)); const id = hit ? hit.id : 'other'; if (id in out) out[id] += Number(votes[i]) || 0; });
  return out;
}

let browser = null, page = null;
async function viaBrowser(url, origin) {
  if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch(); page = await browser.newPage(); }
  if (!page.url().startsWith(origin)) await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page.evaluate(async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(u + ' -> ' + r.status); return r.text(); }, url);
}
async function getText(url, origin) {
  try { const r = await fetch(url, { headers: UA, cache: 'no-store' }); if (r.ok) return await r.text(); if (!origin) throw new Error(url + ' -> ' + r.status); }
  catch (e) { if (!origin) throw e; }
  return viaBrowser(url, origin);   // some county sites block plain requests from data centers
}

async function harris(feed, races) {
  const d = JSON.parse(await getText(feed.url + '?nocache=' + Date.now()));
  const out = {};
  for (const cfg of races) {
    const c = (d.contests || []).find(x => TITLE[cfg.id]?.test(clean(x.t)));
    if (!c) continue;
    out[cfg.id] = { counties: { [feed.fips]: { votes: tally(cfg, c.ca || [], c.tv || []), reporting: { done: d.vc ?? 0, total: d.vt ?? 0 } } } };
  }
  return { races: out, updated: d.dt || null };
}

async function clarity(feed, races) {
  const base = `https://results.enr.clarityelections.com/${feed.path}`;
  const ver = (await getText(`${base}/current_ver.txt`, base + '/')).trim();
  if (!/^\d+$/.test(ver)) throw new Error('no version');
  const list = JSON.parse(await getText(`${base}/${ver}/json/en/summary.json`, base + '/'));
  const out = {};
  for (const cfg of races) {
    const c = (Array.isArray(list) ? list : list.Contests || []).find(x => TITLE[cfg.id]?.test(clean(x.C || x.contestName)));
    if (!c) continue;
    const pr = Number(c.PR ?? c.precinctsReported), tp = Number(c.TP ?? c.totalPrecincts);
    out[cfg.id] = { counties: { [feed.fips]: { votes: tally(cfg, c.CH || [], c.V || []), reporting: Number.isFinite(tp) && tp > 0 ? { done: pr || 0, total: tp } : undefined } } };
  }
  return { races: out };
}

// -> [{ id, races: { [raceId]: { counties: { [fips]: { votes, reporting } } } } }]; a county that fails is skipped and logged.
export async function fetchCountyFeeds(races, log = () => {}, status = {}) {
  const got = [];
  for (const feed of COUNTY_FEEDS) {
    try {
      const r = await (feed.kind === 'harris' ? harris : clarity)(feed, races);
      const n = Object.values(r.races).map(x => Object.values(x.counties[feed.fips].votes).reduce((a, b) => a + b, 0));
      log(`  ${feed.name} County site: ${n.map(v => v.toLocaleString()).join(' / ')} votes`);
      got.push({ id: feed.id, races: r.races }); status[feed.id] = 'ok ' + n.join('/');
    } catch (e) { const m = String(e.message || e).slice(0, 140); log(`  ${feed.name} County site failed: ${m}`); status[feed.id] = 'failed: ' + m.slice(0, 80); }
  }
  if (browser) { await browser.close().catch(() => {}); browser = null; page = null; }
  return got;
}
