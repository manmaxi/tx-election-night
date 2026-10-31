// Election-day "Line check": official polling-place wait times, straight from county election offices.
// Used by the site's /api/waits function (and the social card renderer).
//
// Sources (public, published by the counties for exactly this purpose):
//   Dallas County Elections  - Vote Center Finder feature layer (ArcGIS), wait in minutes, lat/lon.
//   Tarrant County Elections - Voting Wait Times map (gisit.tarrantcounty.com), wait in seconds,
//                              coordinates in NAD83 Texas North Central State Plane (US feet).
// We never estimate a wait. A location without a fresh county report is shown as "not reported".

const UA = { 'user-agent': 'TexasDecides/1.0 (+https://elections.singlestopmarketing.com)' };

const DALLAS_LAYER = 'https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/Vote_Center_Finder_view/FeatureServer/4';
const TARRANT = 'https://gisit.tarrantcounty.com/tcvotingwaittime/Home/GetWaitTimes';

export const WAIT_COUNTIES = [
  { fips: '48113', name: 'Dallas', source: 'Dallas County Elections', sourceUrl: 'https://experience.arcgis.com/experience/8204fc2e36cd4fac8729efcedd4fda7f' },
  { fips: '48439', name: 'Tarrant', source: 'Tarrant County Elections', sourceUrl: 'https://gisit.tarrantcounty.com/tcvotingwaittime/' },
];

// Central Time wall clock -> ISO. CDT through Nov 1, 2026 2 a.m., CST after.
function ctToISO(y, mo, d, h, mi) {
  const asCDT = Date.UTC(y, mo - 1, d, h + 5, mi);
  const off = asCDT < Date.UTC(2026, 10, 1, 7, 0) ? 5 : 6;
  return new Date(Date.UTC(y, mo - 1, d, h + off, mi)).toISOString();
}

// Inverse Lambert Conformal Conic (2SP) on GRS80: EPSG:2276, NAD83 / Texas North Central (ftUS) -> [lon, lat].
const LCC = (() => {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), R = Math.PI / 180, FT = 1200 / 3937;
  const p1 = 33 + 58 / 60, p2 = 32 + 8 / 60, p0 = 31 + 40 / 60, l0 = -98.5, x0 = 600000, y0 = 2000000;
  const m = p => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = (Math.log(m(p1 * R)) - Math.log(m(p2 * R))) / (Math.log(t(p1 * R)) - Math.log(t(p2 * R)));
  const F = m(p1 * R) / (n * t(p1 * R) ** n), r0 = a * F * t(p0 * R) ** n;
  return (X, Y) => {
    const x = X * FT - x0, y = r0 - (Y * FT - y0);
    const r = Math.sign(n) * Math.hypot(x, y), tt = (r / (a * F)) ** (1 / n), th = Math.atan2(x, y);
    let p = Math.PI / 2 - 2 * Math.atan(tt);
    for (let i = 0; i < 8; i++) p = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2));
    return [th / n / R + l0, p / R];
  };
})();

const r5 = v => Math.round(v * 1e5) / 1e5;

async function dallas(fetchImpl) {
  const q = new URLSearchParams({ where: "L_Crnt_Sta='Active'", outFields: 'L_Poll_VC,L_Poll_NM,L_Poll_Add,L_Poll_Typ,L_Poll_Vtg,L_Reside_C,C_Daily_Tot,C_Wait_Tim', outSR: '4326', f: 'json', resultRecordCount: '2000' });
  const [info, data] = await Promise.all([
    fetchImpl(`${DALLAS_LAYER}?f=json`, { headers: UA }).then(r => r.json()),
    fetchImpl(`${DALLAS_LAYER}/query?${q}`, { headers: UA }).then(r => r.json()),
  ]);
  if (!data.features) throw new Error('dallas: ' + (data.error?.message || 'no features'));
  const edited = info.editingInfo?.dataLastEditDate || info.editingInfo?.lastEditDate || null;
  const updated = edited ? new Date(edited).toISOString() : null;
  return data.features.filter(f => f.geometry).map(({ attributes: a, geometry: g }) => ({
    id: 'dal-' + a.L_Poll_VC, county: '48113', name: (a.L_Poll_NM || '').trim(), address: (a.L_Poll_Add || '').trim(),
    room: (a.L_Poll_Vtg || '').trim() || null, city: (a.L_Reside_C || '').trim(),
    kind: a.L_Poll_Typ === 'ED' ? 'ED' : 'EV', lon: r5(g.x), lat: r5(g.y),
    wait: Number.isFinite(a.C_Wait_Tim) ? a.C_Wait_Tim : null, votesToday: Number.isFinite(a.C_Daily_Tot) ? a.C_Daily_Tot : null, updated,
  }));
}

async function tarrant(fetchImpl) {
  const post = body => fetchImpl(TARRANT, { method: 'POST', headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' }, body })
    .then(r => r.json()).then(d => (typeof d === 'string' ? JSON.parse(d) : d));
  const meta = await post('');
  const code = (meta.ActiveElectionList || []).find(e => /active/i.test(e.Status || e.name))?.value || meta.ElectionInformation?.[0]?.Election_Number;
  if (!code) throw new Error('tarrant: no active election');
  const d = await post('ElectionCode=' + encodeURIComponent(code));
  // A report counts as Election Day only if it was made on or after Election Day (Central Time).
  const ed = /(\d+)\/(\d+)\/(\d{4})/.exec(d.ElectionInformation?.[0]?.VoterElectionDate || '11/03/2026');
  const edStart = Date.parse(ctToISO(+ed[3], +ed[1], +ed[2], 0, 0));
  return (d.ElectionLocations || []).filter(l => l.X && l.Y).map(l => {
    const [lon, lat] = LCC(+l.X, +l.Y);
    const m = /(\d+)\/(\d+)\/(\d{4})\s+(\d+):(\d+)\s*(AM|PM)/i.exec(l.LastUpdated || '');
    const updated = m ? ctToISO(+m[3], +m[1], +m[2], (+m[4] % 12) + (/pm/i.test(m[6]) ? 12 : 0), +m[5]) : null;
    const secs = l.WaitTime === '' || l.WaitTime == null ? null : +l.WaitTime;
    return {
      id: 'tar-' + (l.PollingPlaceCode || l.POLLING_PL), county: '48439', name: (l.POLLING_PL || '').trim(), address: [l.POLLING_LO, l.CITY].filter(Boolean).join(', ').trim(),
      room: null, city: (l.CITY || '').trim(), kind: updated && Date.parse(updated) >= edStart ? 'ED' : 'EV',
      lon: r5(lon), lat: r5(lat), wait: Number.isFinite(secs) ? Math.round(secs / 60) : null, votesToday: null, updated,
    };
  });
}

export async function fetchWaits(fetchImpl = fetch, now = Date.now()) {
  const out = { fetched: new Date(now).toISOString(), counties: [], locations: [] };
  const jobs = [['48113', dallas], ['48439', tarrant]];
  const res = await Promise.allSettled(jobs.map(([, fn]) => fn(fetchImpl)));
  res.forEach((r, i) => {
    const c = WAIT_COUNTIES.find(x => x.fips === jobs[i][0]);
    if (r.status === 'fulfilled' && r.value.length) {
      const ts = r.value.map(l => l.updated && Date.parse(l.updated)).filter(Boolean);
      out.counties.push({ ...c, ok: true, count: r.value.length, updated: ts.length ? new Date(Math.max(...ts)).toISOString() : null });
      out.locations.push(...r.value);
    } else out.counties.push({ ...c, ok: false, error: r.status === 'rejected' ? String(r.reason?.message || r.reason).slice(0, 120) : 'no locations' });
  });
  return out;
}
