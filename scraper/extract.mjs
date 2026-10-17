// Turns whatever JSON a results site loaded into one normalized shape:
//   { [raceId]: { state: Entry|null, counties: { [fips]: Entry } } }
//   Entry = { votes: { [candidateId]: n }, reporting?: { done, total } }
// It walks every object, tracking which race and which county it is inside, and picks up
// candidate vote counts by matching candidate names from config.mjs.
import fs from 'node:fs';

const geo = JSON.parse(fs.readFileSync(new URL('../site/data/tx-geo.json', import.meta.url), 'utf8'));
const norm = s => String(s).toLowerCase().replace(/\bcounty\b/g, '').replace(/[^a-z]/g, '');
const byName = new Map(geo.counties.map(c => [norm(c.name), c.fips]));
// Texas counties are numbered 1–254 alphabetically, and their FIPS codes follow the same order.
const byIndex = new Map([...geo.counties].sort((a, b) => a.name.localeCompare(b.name)).map((c, i) => [i + 1, c.fips]));
export const COUNTY_FIPS = new Set(geo.counties.map(c => c.fips));

const NAME_KEYS = /^(name|n|c|ch|title|label|desc|description|ballotname|candidate|candidatename|choice|choicename|fullname|racename|contest|contestname|office|officename|county|countyname|jurisdiction|area)$/i;
const VOTE_KEYS = /^(votes?|v|tv|total|totalvotes|votecount|votetotal|count|ballots|value)$/i;
const DONE_KEYS = /(precincts?|locations?|centers?|polls?)?_?(reporting|reported|counted|completed?)$/i;
const ALL_KEYS = /^(total)?_?(precincts?|locations?|centers?|polls?)(_?total|_?count)?$|^(tp|totalprecincts|precinctstotal|totallocations)$/i;

function countyFrom(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      if (/county|jurisdiction|area|^n(ame)?$/i.test(k) && byName.has(norm(v))) return byName.get(norm(v));
      if (/fips/i.test(k) && COUNTY_FIPS.has(v.padStart(5, '48').slice(-5))) return v.padStart(5, '48').slice(-5);
    }
    if (typeof v === 'number' && /^county_?(id|code|num|number)?$/i.test(k) && byIndex.has(v)) return byIndex.get(v);
  }
  return null;
}
function raceFrom(obj, races) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string' || !(NAME_KEYS.test(k) || /race|contest|office|title|label|desc/i.test(k))) continue;
    const r = races.find(r => r.match.test(v));
    if (r) return r.id;
  }
  return null;
}
function voteOf(obj) {
  let best = null;
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'number' && VOTE_KEYS.test(k)) best = Math.max(best ?? 0, v);
  if (best == null) for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && VOTE_KEYS.test(k) && /^\d[\d,]*$/.test(v)) best = Math.max(best ?? 0, +v.replace(/,/g, ''));
  return best;
}
function reportingOf(obj) {
  let done = null, total = null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'number') continue;
    if (DONE_KEYS.test(k) && !/percent|pct/i.test(k)) done = v;
    else if (ALL_KEYS.test(k)) total = v;
  }
  return done != null && total ? { done, total } : null;
}

export function extract(captures, races) {
  const out = Object.fromEntries(races.map(r => [r.id, { state: null, counties: {} }]));
  const put = (raceId, fips, candId, votes) => {
    const bucket = out[raceId];
    const e = fips ? (bucket.counties[fips] ??= { votes: {} }) : (bucket.state ??= { votes: {} });
    e.votes[candId] = Math.max(e.votes[candId] || 0, votes); // the same number often appears twice
  };
  const putRep = (raceId, fips, rep) => {
    const bucket = out[raceId];
    const e = fips ? (bucket.counties[fips] ??= { votes: {} }) : (bucket.state ??= { votes: {} });
    if (!e.reporting || rep.done >= e.reporting.done) e.reporting = rep;
  };

  const walk = (node, raceId, fips, depth) => {
    if (depth > 40 || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const x of node) walk(x, raceId, fips, depth + 1); return; }
    const r = raceFrom(node, races) || raceId;
    const f = countyFrom(node) || fips;
    if (r) {
      const race = races.find(x => x.id === r);
      // Is this object a candidate line?
      for (const [k, v] of Object.entries(node)) {
        if (typeof v !== 'string' || !NAME_KEYS.test(k)) continue;
        const cand = race.candidates.find(c => c.match && c.match.test(v));
        if (cand) {
          const votes = voteOf(node);
          if (votes != null) put(r, f, cand.id, votes);
          break;
        }
      }
      // Parallel arrays, e.g. { CH: ["Ken Paxton", ...], V: [123, ...] }
      for (const [k, v] of Object.entries(node)) {
        if (!Array.isArray(v) || !v.length || typeof v[0] !== 'string' || !NAME_KEYS.test(k)) continue;
        const nums = Object.entries(node).find(([k2, v2]) => k2 !== k && Array.isArray(v2) && v2.length === v.length && typeof v2[0] === 'number' && VOTE_KEYS.test(k2));
        if (!nums) continue;
        v.forEach((name, i) => { const cand = race.candidates.find(c => c.match && c.match.test(name)); if (cand) put(r, f, cand.id, nums[1][i]); });
      }
      const rep = reportingOf(node);
      if (rep && raceFrom(node, races)) putRep(r, f, rep);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, r, f, depth + 1);
  };
  for (const c of captures) walk(c.json, null, null, 0);
  return out;
}

// Early-voting turnout by county: in person, by mail, cumulative total, registered voters.
export function extractTurnout(captures) {
  const counties = {};
  const pick = (obj, re) => { for (const [k, v] of Object.entries(obj)) { const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d[\d,]*$/.test(v) ? +v.replace(/,/g, '') : null); if (n != null && re.test(k)) return n; } return null; };
  const walk = (node, depth) => {
    if (depth > 40 || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(x => walk(x, depth + 1)); return; }
    const f = countyFrom(node);
    if (f) {
      const inPerson = pick(node, /in_?person/i);
      const mail = pick(node, /mail/i);
      const registered = pick(node, /regist/i);
      let total = pick(node, /cumulative|total_?(votes|voters|turnout|voted)|^total$/i);
      if (total == null && (inPerson != null || mail != null)) total = (inPerson || 0) + (mail || 0);
      if (total != null) {
        const prev = counties[f];
        if (!prev || total >= prev.total) counties[f] = { inPerson, mail, total, registered: registered ?? prev?.registered ?? null };
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  for (const c of captures) walk(c.json, 0);
  return counties;
}
