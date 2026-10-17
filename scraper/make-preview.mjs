// Writes starter data files: the 2026 races with no results yet, plus a clearly labeled replay of
// the real 2024 presidential county results so the map and tables can be checked before Nov 3.
// Run: node scraper/make-preview.mjs   (the live scraper overwrites these files later)
import fs from 'node:fs';
import { ELECTION, RACES } from './config.mjs';

const here = new URL('.', import.meta.url);
const out = new URL('../site/data/', import.meta.url);
const now = new Date().toISOString();

const csv = fs.readFileSync(new URL('fixture-2024-president.csv', here), 'utf8').trim().split('\n');
const head = csv.shift().split(',');
const col = n => head.indexOf(n);
const counties = {};
let gop = 0, dem = 0, tot = 0;
for (const line of csv) {
  const c = line.split(',');
  if (c[col('state_name')] !== 'Texas') continue;
  const r = +c[col('votes_gop')], d = +c[col('votes_dem')], t = +c[col('total_votes')];
  counties[c[col('county_fips')]] = { votes: { trump: r, harris: d, other: t - r - d }, total: t, reporting: { done: 1, total: 1 } };
  gop += r; dem += d; tot += t;
}

const replay = {
  id: 'replay2024',
  title: '2024 replay',
  demo: true,
  note: 'Final 2024 presidential results in Texas, shown so you can see how the map looks once every county reports. Not 2026 data.',
  candidates: [
    { id: 'harris', name: 'Kamala Harris', party: 'D' },
    { id: 'trump', name: 'Donald Trump', party: 'R' },
    { id: 'other', name: 'All others', party: 'O' },
  ],
  statewide: { votes: { trump: gop, harris: dem, other: tot - gop - dem }, total: tot, reporting: { done: 254, total: 254, unit: 'counties' } },
  counties,
  history: [],
};

const races = RACES.map(r => ({
  id: r.id,
  title: r.title,
  candidates: r.candidates.map(({ id, name, party, photoCredit, photoPos }) => {
    const photo = ['jpg', 'jpeg', 'png', 'webp'].map(x => `img/${id}.${x}`).find(f => fs.existsSync(new URL(`../site/${f}`, import.meta.url)));
    return photo ? { id, name, party, photo, ...(photoPos ? { photoPos } : {}), ...(photoCredit ? { photoCredit } : {}) } : { id, name, party };
  }),
  statewide: { votes: {}, total: 0, reporting: { done: 0, total: 254, unit: 'counties' } },
  counties: {},
  history: [],
}));

const results = {
  updated: now,
  election: ELECTION,
  races: [...races, replay],
};
const turnout = {
  updated: null,
  label: 'Early voting turnout',
  statewide: null,
  counties: {},
};

fs.writeFileSync(new URL('results.json', out), JSON.stringify(results));
fs.writeFileSync(new URL('turnout.json', out), JSON.stringify(turnout));
console.log('Texas counties in 2024 replay:', Object.keys(counties).length, 'total votes:', tot);

// Store each county's 2024 turnout in the map file: used to rank counties before results
// arrive and to estimate how much of the expected vote is in.
const geoUrl = new URL('tx-geo.json', out);
const geo = JSON.parse(fs.readFileSync(geoUrl, 'utf8'));
for (const c of geo.counties) c.b = counties[c.fips]?.total || 0;
fs.writeFileSync(geoUrl, JSON.stringify(geo));
console.log('2024 baseline added to', geo.counties.filter(c => c.b).length, 'counties');
