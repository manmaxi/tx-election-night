// Reads the Texas Secretary of State's election night system (run by Civix since 2025).
//   Results:  /api-ivis-system/api/s3/enr/election/countyInfo/{electionId}
//             -> { upload: base64(JSON) } keyed by county number 1–254 (alphabetical; FIPS = 48000 + 2n - 1)
//             each county: { N, Summary: { RV registered, VC votes cast, PLR/NPL polling locations }, Races: { [id]: { N, C: { [id]: { N, P, V, EV } } } } }
//   Status:   /api-ivis-system/api/s3/enr/election/{electionId} -> { Home: base64({ PollingReporting, CountiesReporting, LastUpdatedTime }) , ... }
//   Turnout:  /api-ivis-system/api/v1/getFile?type=EVR_ELECTION (election list + early voting dates)
//             /api-ivis-system/api/v1/getFile?type=EVR_EARLYVOTING&electionId=…&electionDate=MM/DD/YYYY
export const BASE = 'https://goelect.txelections.civixapps.com';
const API = '/api-ivis-system/api';
const HEADERS = { accept: 'application/json', 'user-agent': 'TexasElectionNight/1.0 (+https://elections.singlestopmarketing.com; nonpartisan results map)' };

export const decode = s => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const unwrap = j => (j && typeof j.upload === 'string' ? decode(j.upload) : j);
export const fipsFromIndex = n => String(48000 + 2 * Number(n) - 1);

// Plain HTTPS first; if the site's bot protection answers instead of JSON, fetch from inside a real browser page.
export async function openClient(log = () => {}) {
  try {
    const r = await fetch(BASE + API + '/s3/enr/electionConstants', { headers: HEADERS });
    if (r.ok && /json/i.test(r.headers.get('content-type') || '')) {
      log('  state feed: direct HTTPS works');
      return {
        get: async p => { const x = await fetch(BASE + p, { headers: HEADERS, cache: 'no-store' }); if (!x.ok) throw new Error(`${p} → ${x.status}`); return x.json(); },
        close: async () => {},
      };
    }
    log(`  state feed: direct HTTPS answered ${r.status}; switching to a browser`);
  } catch (e) { log(`  state feed: direct HTTPS failed (${e.message}); switching to a browser`); }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + '/ivis-enr-ui/races', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  return {
    get: p => page.evaluate(async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(u + ' → ' + r.status); return r.json(); }, p),
    close: () => browser.close(),
  };
}

export async function findElectionId(client, { civixName, civixId }) {
  try {
    const c = unwrap(await client.get(API + '/s3/enr/electionConstants'));
    for (const byType of Object.values(c.electionInfo || {})) for (const list of Object.values(byType)) for (const e of Object.values(list)) {
      if (civixName.test(e.N)) return String(e.ID);
    }
  } catch { /* fall back to the known id */ }
  return String(civixId);
}

export async function fetchResults(client, electionId) {
  const [countyInfo, election] = await Promise.all([
    client.get(`${API}/s3/enr/election/countyInfo/${electionId}`),
    client.get(`${API}/s3/enr/election/${electionId}`),
  ]);
  return { countyInfo: unwrap(countyInfo), home: election?.Home ? decode(election.Home) : null };
}

// -> { races: { [raceId]: { state: null, counties: { [fips]: { votes, reporting } } } }, registered: { [fips]: n }, status }
export function parseResults({ countyInfo, home }, raceConfigs) {
  const races = Object.fromEntries(raceConfigs.map(r => [r.id, { state: null, counties: {} }]));
  const registered = {};
  for (const [n, county] of Object.entries(countyInfo || {})) {
    const fips = fipsFromIndex(n);
    if (county.Summary?.RV) registered[fips] = county.Summary.RV;
    const reporting = county.Summary ? { done: county.Summary.PLR ?? 0, total: county.Summary.NPL ?? 0 } : undefined;
    for (const race of Object.values(county.Races || {})) {
      const cfg = raceConfigs.find(r => r.match.test(String(race.N).trim()));
      if (!cfg) continue;
      const votes = Object.fromEntries(cfg.candidates.map(c => [c.id, 0]));
      for (const cand of Object.values(race.C || {})) {
        const hit = cfg.candidates.find(c => c.match && c.match.test(cand.N));
        const id = hit ? hit.id : (votes.other !== undefined ? 'other' : null);
        if (id) votes[id] += Number(cand.V) || 0;
      }
      races[cfg.id].counties[fips] = { votes, reporting };
    }
  }
  const status = home ? {
    polling: home.PollingReporting ? { done: home.PollingReporting.PLR, total: home.PollingReporting.PLT } : null,
    counties: home.CountiesReporting ? { done: home.CountiesReporting.CR, total: home.CountiesReporting.CT } : null,
    lastUpdated: home.LastUpdatedTime || null,
  } : null;
  return { races, registered, status };
}

const mdy = d => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

// Latest available early-voting day for this election, newest first.
export async function fetchTurnout(client, electionId, now = new Date()) {
  const list = unwrap(await client.get(`${API}/v1/getFile?type=EVR_ELECTION`));
  const el = [...(list.elections || []), ...(list.elections_local || [])].find(e => String(e.id) === String(electionId));
  if (!el) return null;
  const todayCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const dates = (el.early_voting_dates || []).map(x => x.date).filter(d => new Date(d) <= todayCT).reverse();
  for (const date of [mdy(todayCT), ...dates]) {
    try {
      const d = unwrap(await client.get(`${API}/v1/getFile?type=EVR_EARLYVOTING&electionId=${electionId}&electionDate=${date}`));
      if (d?.turnout_by_county?.length) return d;
    } catch { /* that day isn't posted yet; try the one before */ }
  }
  return null;
}

export function parseTurnout(d) {
  const counties = {};
  for (const r of d.turnout_by_county || []) {
    const inPerson = Number(r.total_in_person_votes_for_election) || 0, mail = Number(r.total_mail_votes_for_election) || 0;
    counties[fipsFromIndex(r.id)] = { inPerson, mail, total: inPerson + mail, registered: Number(r.registered_voters) || null };
  }
  return { asOf: d.early_voting_date || null, counties };
}

// Day-by-day running totals for the early-voting chart. Past days are kept from `known`;
// only new days and the latest two (which can still be revised) are fetched again.
export async function fetchTurnoutDaily(client, electionId, known = [], now = new Date()) {
  const list = unwrap(await client.get(`${API}/v1/getFile?type=EVR_ELECTION`));
  const el = [...(list.elections || []), ...(list.elections_local || [])].find(e => String(e.id) === String(electionId));
  if (!el) return { dates: [], daily: known };
  const all = (el.early_voting_dates || []).map(x => x.date);
  const todayCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const due = all.filter(d => new Date(d) <= todayCT);
  const iso = d => { const [m, dd, y] = d.split('/'); return `${y}-${m}-${dd}`; };
  const byDate = new Map(known.map(k => [k.date, k]));
  const refetch = new Set(due.slice(-2));
  let latest = null;
  for (const d of due) {
    if (byDate.has(iso(d)) && !refetch.has(d)) continue;
    try {
      const raw = unwrap(await client.get(`${API}/v1/getFile?type=EVR_EARLYVOTING&electionId=${electionId}&electionDate=${d}`));
      if (!raw?.turnout_by_county?.length) continue;
      const t = parseTurnout(raw);
      const v = Object.values(t.counties);
      const sum = k => v.reduce((a, c) => a + (c[k] || 0), 0);
      byDate.set(iso(d), { date: iso(d), inPerson: sum('inPerson'), mail: sum('mail'), total: sum('total') });
      latest = raw;
    } catch { /* not posted yet */ }
  }
  return { dates: all.map(iso), daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), latest };
}
