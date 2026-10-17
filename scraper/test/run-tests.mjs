// Checks the scraper against REAL files saved from the Texas Secretary of State's results system:
//   fixtures/runoff-58315-countyInfo.json  May 26, 2026 GOP Senate runoff, all 254 counties (Senate race only)
//   fixtures/evr-53815-2026-10-16.json     Nov 2026 general, early-voting turnout as of Oct 16 (compact form)
// Run: node scraper/test/run-tests.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extract } from '../extract.mjs';
import { RACES } from '../config.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const fx = n => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', n), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'txel-'));
const inDir = path.join(tmp, 'in'), out = path.join(tmp, 'out');
fs.mkdirSync(inDir); fs.mkdirSync(out);
const run = () => execFileSync('node', [path.join(here, '../run.mjs'), `--from=${inDir}`, `--out=${out}`], { encoding: 'utf8' });

let fails = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };

// --- 1. Results, from the real runoff file. Paxton matches; Cornyn isn't on the November ballot, so he lands in "other".
const county = fx('runoff-58315-countyInfo.json');
fs.writeFileSync(path.join(inDir, 'countyInfo.json'), JSON.stringify(county));
fs.writeFileSync(path.join(inDir, 'home.json'), JSON.stringify({ PollingReporting: { PLR: 3145, PLT: 3145 }, CountiesReporting: { CR: 254, CT: 254 }, LastUpdatedTime: 'Jun 12, 2026 19:23:34' }));
const ev = fx('evr-53815-2026-10-16.json');
fs.writeFileSync(path.join(inDir, 'evr.json'), JSON.stringify({ early_voting_date: ev.date, turnout_by_county: ev.rows.map(([id, rv, ip, mail]) => ({ id, registered_voters: rv, total_in_person_votes_for_election: ip, total_mail_votes_for_election: mail })) }));
console.log(run().trim().split('\n').map(l => '      ' + l).join('\n'));

const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
const sen = res.races.find(r => r.id === 'senate');
check('statewide Paxton matches the state total', sen.statewide.votes.paxton === 888196, sen.statewide.votes.paxton);
check('statewide others (Cornyn) match the state total', sen.statewide.votes.other === 503438, sen.statewide.votes.other);
check('all 254 counties came through', Object.keys(sen.counties).length === 254, Object.keys(sen.counties).length);
check('county numbers land on the right county (Harris = 48201)', sen.counties['48201']?.votes.paxton === 93872, JSON.stringify(sen.counties['48201']?.votes));
check('county codes map to FIPS (Anderson = 48001, Zavala = 48507)', !!sen.counties['48001'] && !!sen.counties['48507']);
check('polling locations reporting read from the state status', sen.statewide.reporting.done === 3145 && sen.statewide.reporting.unit === 'polling locations');
check('governor stays empty (not in this file)', res.races.find(r => r.id === 'governor').statewide.total === 0);
check('2024 replay tab drops once real votes exist', !res.races.some(r => r.demo));

// --- 2. Turnout.
const tur = JSON.parse(fs.readFileSync(path.join(out, 'turnout.json'), 'utf8'));
check('turnout: all 254 counties', Object.keys(tur.counties).length === 254);
check('turnout: statewide registered voters match the state file', tur.statewide.registered === 19041684, tur.statewide.registered);
check('turnout: statewide mail ballots match the state file', tur.statewide.mail === 40048, tur.statewide.mail);
check('turnout: Harris registered voters and mail ballots', tur.counties['48201']?.registered === 2746177 && tur.counties['48201']?.mail === 15652);

// --- 3. A short read for one county must not overwrite the better number.
const bad = JSON.parse(JSON.stringify(county));
for (const r of Object.values(bad['101'].Races)) for (const c of Object.values(r.C)) c.V = 1;
fs.writeFileSync(path.join(inDir, 'countyInfo.json'), JSON.stringify(bad));
run();
const res2 = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
check('a county never goes backwards on a bad read', res2.races[0].counties['48201'].votes.paxton === 93872);

// --- 4. Generic extractor used for optional county sites.
const layout = [{ county: 'Webb County', contests: [{ C: 'U. S. Senator', CH: ['Ken Paxton', 'James Talarico'], V: [10, 20] }] }];
const ex = extract([{ url: 'x', json: layout }], RACES);
check('county-site extractor reads a parallel-array layout', ex.senate.counties['48479']?.votes.talarico === 20);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
