// Wraps site/index.html in a full HTML document and copies data into dist/ for static hosting
// (Cloudflare Pages, Vercel, Netlify). Run: node scripts/build-site.mjs
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(new URL('data/', dist), { recursive: true });

const page = fs.readFileSync(new URL('site/index.html', root), 'utf8');
const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
  `<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>` +
  `</head><body>${page}</body></html>`;
fs.writeFileSync(new URL('index.html', dist), doc);
for (const f of fs.readdirSync(new URL('site/data/', root))) fs.copyFileSync(new URL(`site/data/${f}`, root), new URL(`data/${f}`, dist));
// The public site never shows the 2024 replay tab; it exists only for previewing the design.
const resUrl = new URL('data/results.json', dist);
if (fs.existsSync(resUrl)) { const r = JSON.parse(fs.readFileSync(resUrl, 'utf8')); r.races = r.races.filter(x => !x.demo); fs.writeFileSync(resUrl, JSON.stringify(r)); }
if (fs.existsSync(new URL('site/img/', root))) fs.cpSync(new URL('site/img/', root), new URL('img/', dist), { recursive: true });
if (fs.existsSync(new URL('site/og.png', root))) fs.copyFileSync(new URL('site/og.png', root), new URL('og.png', dist));
// Short cache on data so the 60-second refresh sees new numbers; Netlify/Cloudflare Pages read _headers.
fs.writeFileSync(new URL('_headers', dist), '/data/*\n  Cache-Control: public, max-age=30, must-revalidate\n/og.png\n  Cache-Control: public, max-age=120\n');
console.log('built dist/');
