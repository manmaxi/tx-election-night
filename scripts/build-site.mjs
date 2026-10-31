// Wraps site/index.html in a full HTML document and copies data into dist/ for static hosting
// (Cloudflare Pages, Vercel, Netlify). Run: node scripts/build-site.mjs
// Also writes dist/markets/index.html: the same page with its own X card (the markets share card).
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const SITE = 'https://elections.singlestopmarketing.com/';
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(new URL('data/', dist), { recursive: true });

// Card images get a content hash in their URL, so X and other apps fetch the new image whenever it changes.
const ver = f => { const u = new URL(`site/${f}`, root); return fs.existsSync(u) ? crypto.createHash('sha1').update(fs.readFileSync(u)).digest('hex').slice(0, 10) : '0'; };
const page = fs.readFileSync(new URL('site/index.html', root), 'utf8')
  .replaceAll(`${SITE}og.png"`, `${SITE}og.png?v=${ver('og.png')}"`);
const wrap = (body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${head}` +
  `<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>` +
  `</head><body>${body}</body></html>`;
fs.writeFileSync(new URL('index.html', dist), wrap(page));

// /markets/: same page, scrolled to the markets section, with the markets card and its own title.
const mTitle = 'Texas Decides · What prediction markets are pricing';
const mDesc = "Traders' prices for the Texas U.S. Senate and Governor races, next to the official count on election night. Prices, not votes.";
const markets = page
  .replace(/<title>[^<]*<\/title>/, `<title>${mTitle}</title>`)
  .replace(/(property="og:title" content=")[^"]*/, `$1${mTitle}`).replace(/(name="twitter:title" content=")[^"]*/, `$1${mTitle}`)
  .replace(/(property="og:description" content=")[^"]*/, `$1${mDesc}`).replace(/(name="twitter:description" content=")[^"]*/, `$1${mDesc}`)
  .replace(/(property="og:url" content=")[^"]*/, `$1${SITE}markets/`)
  .replace(/og\.png\?v=[0-9a-f]+"/g, `og-markets.png?v=${ver('og-markets.png')}"`);
fs.mkdirSync(new URL('markets/', dist), { recursive: true });
fs.writeFileSync(new URL('markets/index.html', dist), wrap(markets, '<base href="/">'));
// /lines/: the Line check page. Same app, but the class "lcp" hides everything except the tool (set before first paint).
const lTitle = 'Texas Decides · Line check: find your fastest place to vote';
const lDesc = 'Official polling-place wait times from Dallas and Tarrant counties, plus drive time. Vote at any vote center in your county.';
const lines = page
  .replace(/<title>[^<]*<\/title>/, `<title>${lTitle}</title>`)
  .replace(/(property="og:title" content=")[^"]*/, `$1${lTitle}`).replace(/(name="twitter:title" content=")[^"]*/, `$1${lTitle}`)
  .replace(/(property="og:description" content=")[^"]*/, `$1${lDesc}`).replace(/(name="twitter:description" content=")[^"]*/, `$1${lDesc}`)
  .replace(/(property="og:url" content=")[^"]*/, `$1${SITE}lines/`)
  .replace(/og\.png\?v=[0-9a-f]+"/g, `og-lines.png?v=${ver('og-lines.png')}"`);
fs.mkdirSync(new URL('lines/', dist), { recursive: true });
fs.writeFileSync(new URL('lines/index.html', dist), wrap(lines, '<base href="/"><script>document.documentElement.classList.add("lcp")</script>'));

for (const f of fs.readdirSync(new URL('site/data/', root))) fs.copyFileSync(new URL(`site/data/${f}`, root), new URL(`data/${f}`, dist));
// The public site never shows the 2024 replay tab; it exists only for previewing the design.
const resUrl = new URL('data/results.json', dist);
if (fs.existsSync(resUrl)) { const r = JSON.parse(fs.readFileSync(resUrl, 'utf8')); r.races = r.races.filter(x => !x.demo); fs.writeFileSync(resUrl, JSON.stringify(r)); }
if (fs.existsSync(new URL('site/img/', root))) fs.cpSync(new URL('site/img/', root), new URL('img/', dist), { recursive: true });
for (const f of ['election-night.ics', 'early-voting.ics', 'og.png', 'og-markets.png', 'og-lines.png', 'card.html']) if (fs.existsSync(new URL(`site/${f}`, root))) fs.copyFileSync(new URL(`site/${f}`, root), new URL(f, dist));
// Short cache on data so the 60-second refresh sees new numbers; Netlify/Cloudflare Pages read _headers.
fs.writeFileSync(new URL('_headers', dist), '/data/*\n  Cache-Control: public, max-age=30, must-revalidate\n/og.png\n  Cache-Control: public, max-age=120\n/og-markets.png\n  Cache-Control: public, max-age=120\n/og-lines.png\n  Cache-Control: public, max-age=300\n/*.ics\n  Content-Type: text/calendar; charset=utf-8\n');
console.log('built dist/');
