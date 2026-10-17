// Opens a results site in a headless browser and keeps every JSON response it loads.
// This works without knowing the site's private API paths, and keeps working if they change.
import { chromium } from 'playwright';

export async function capture(source, { raceMatchers = [], timeoutMs = 45000, log = () => {} } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 tx-election-night-map',
    viewport: { width: 1280, height: 900 },
  });
  const found = [];
  page.on('response', async res => {
    try {
      const type = res.headers()['content-type'] || '';
      if (!/json/i.test(type) && !/\.json(\?|$)/i.test(res.url())) return;
      const json = await res.json();
      found.push({ url: res.url(), json });
    } catch { /* not JSON, or body already gone */ }
  });

  try {
    await page.goto(source.url, { waitUntil: 'networkidle', timeout: timeoutMs });
    // Open each race's detail view, which is usually where county-level numbers load.
    for (const re of raceMatchers) {
      const link = page.getByText(re).first();
      if (await link.count()) {
        log(`  opening race view matching ${re}`);
        await link.click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
        // Many portals have a "by county" tab or toggle.
        const byCounty = page.getByText(/by county|county results|counties/i).first();
        if (await byCounty.count()) {
          await byCounty.click({ timeout: 5000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
        }
        await page.goto(source.url, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => {});
      }
    }
    // Some sites embed their data in the page instead of fetching it.
    const inline = await page.$$eval('script[type="application/json"], script#__NEXT_DATA__', els => els.map(e => e.textContent));
    for (const txt of inline) { try { found.push({ url: source.url + '#inline', json: JSON.parse(txt) }); } catch {} }
  } finally {
    await browser.close();
  }
  log(`  ${source.id}: captured ${found.length} JSON responses`);
  return found;
}
