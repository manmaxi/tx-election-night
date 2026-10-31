# Texas Decides 2026

A live, county-by-county results page for the Texas U.S. Senate and Governor races. It is built to share on X and to read well on phones.

- `site/` is the page. It re-reads `site/data/results.json` and `site/data/turnout.json` every 60 seconds.
- `scraper/` fills those files from the Texas Secretary of State's election night system. Since 2025, Civix runs it at goelect.txelections.civixapps.com. The old results.texas-election.com portal is frozen at 2024. The scraper reads three things:
  - **County results.** Every county's votes in every race, plus polling locations reporting and registered voters: `api-ivis-system/api/s3/enr/election/countyInfo/53815`.
  - **Statewide status.** Polling locations reporting and the state's last-update time: `…/enr/election/53815`.
  - **Early-voting turnout by county.** In person, mail, and registered voters: `api-ivis-system/api/v1/getFile?type=EVR_EARLYVOTING&electionId=53815&electionDate=MM/DD/YYYY`.

  The state sends each file as base64 JSON. Counties are numbered 1–254 alphabetically, and FIPS = 48000 + 2n − 1. If the site's bot protection blocks plain requests, the scraper fetches the same files from inside a headless browser.
- `.github/workflows/scrape.yml` runs the scraper on GitHub's servers:
  - Each run keeps checking for about 5.5 hours, then starts its own replacement. GitHub's scheduler skips many runs on small repositories, so the schedules only restart the chain if it breaks.
  - It checks every 30 minutes during early voting, every 2 minutes from 6:45 p.m. CT on Nov. 3 until 6 a.m., then every 10 minutes through Nov. 6. The chain stops after Nov. 7.
  - Each pass that finds new numbers commits them, and the host redeploys.
  - To stop it, cancel the running "Update results" job in the Actions tab; to restart it, use Run workflow.

## Prediction markets

- `functions/api/markets.js` is a Cloudflare Pages Function. It serves Polymarket prices for both races, fetched at most once a minute and cached at the edge, so prices stay current with no rebuilds. The shared logic lives in `lib/markets.mjs`.
- Until polls close, the top of the page is a **market face-off** for the selected race: both photos, a tug-of-war price bar, a chart you can drag to read any day (7D, 30D or 1Y), and a Replay that animates the race's history (it plays once when the page opens, never with reduced motion). It disappears at 7 p.m. CT on Nov. 3 and the results cards take its place. The main X card always shows the cards, never prices.
- The page shows them in their own "What traders are pricing" section and, until polls close, as two ticker items. They never appear in the candidate cards, the map or the main X card. After 7 p.m. CT on Nov. 3 the section collapses and leaves the ticker.
- `/markets/` is the same page with its own X card, `site/og-markets.png`. The scraper re-renders that card once a day, or at most every 3 hours when a price moves 2¢ or more. It skips Nov. 3, 6 p.m. CT, through Nov. 6 to save builds for results.
- Card image URLs carry a content hash, and share links carry the date, so each day's post on X shows that day's card.
- Kalshi is not shown: its Developer Agreement limits API data to a member's own trading and forbids sharing it without written permission. Robinhood's election contracts mostly come from Kalshi and it has no public feed.

## Line check (Election Day wait times)

- `functions/api/waits.js` (with `lib/waits.mjs`) serves official polling-place wait times from Dallas County (ArcGIS Vote Center Finder layer) and Tarrant County (its Voting Wait Times service; State Plane coordinates are converted to lat/lon). Cached 90 seconds at the edge; the last good copy is served for up to 6 hours if a county is down.
- Before Election Day it serves the final early-voting readings (labeled on the page); on Nov. 3, 6 a.m.–10 p.m. CT, only Election Day vote centers; after that the tool hides itself.
- The page's "Find my fastest place to vote" ranks vote centers in the visitor's county by an estimated drive time plus the county's reported wait. Location stays in the browser. Reports older than 75 minutes on Election Day show as "no recent report."
- `/lines/` opens the page at the tool with its own X card (`site/og-lines.png`); `card.html?type=lines` renders post images.

## Set up (about 20 minutes)

1. **Put this folder in a new GitHub repo.** A public repo gets free Actions minutes.
2. **Connect the repo to Cloudflare Pages.** Use build command `npm run build` and output folder `dist`. Add your domain, `elections.singlestopmarketing.com`.
   - Cloudflare Pages allows 500 builds a month on the free plan. That covers election night's roughly 180 deploys.
   - Vercel's free plan caps deploys at 100 a day, so it can run out on election night.
3. **Allow the workflow to push.** In GitHub, go to Settings → Actions → General → Workflow permissions and choose "Read and write".
4. **Start it once by hand.** Go to Actions → Update results → Run workflow. That starts the self-renewing chain.
   - The Nov. 3 election is already staged in the state's system with all candidates at zero.
   - Early-voting turnout has been posting since Oct. 14, so the first run should fill the turnout map.
5. **Optional: add the big counties' own results pages** in `scraper/config.mjs` (`COUNTY_SOURCES`). Harris, Dallas, Tarrant, Bexar, Travis, and Collin often post before the state feed. For each county, the scraper keeps whichever source has counted more ballots.

## Commands

```
npm install && npx playwright install chromium
npm test                          # checks the scraper against real files saved from the state's system
node scraper/make-preview.mjs     # resets data files to "no results yet" plus the 2024 replay tab
node scraper/run.mjs              # one live pass (results + turnout)
node scraper/run.mjs --og         # also renders site/og.png, the image X shows in the link card
npm run build                     # builds dist/ for hosting
```

## Safeguards

- **No race calls.** The page never projects a winner. It shows "Leading" only while votes are coming in.
- **Bad reads are rejected.** If a pass would make a statewide total drop by more than 3%, nothing is published. A single county's count never moves backwards.
- **Quiet passes stay quiet.** Files are only rewritten, committed, and redeployed when the numbers actually change.
- **Labeled as unofficial.** Every view says the results are unofficial and names the source. The status dot turns amber if data is more than 15 minutes old.
- **Preview-only replay tab.** The "2024 replay" tab uses real final 2024 presidential county results to preview the design. It is stripped from the public build and also drops out of the data once 2026 votes arrive.
- **Neutral presentation.** Candidates are listed alphabetically until votes arrive. Party colors and map shades are matched in strength. Turnout uses a non-party green. Third-party and write-in votes count in "All others", so percentages match the state's.
- **Photo licenses.** All four photos come from Wikimedia Commons (CC BY-SA or public domain). The footer's "Photo credits" panel (also at `#credits`) carries the required attribution; don't remove it.
- **Two timestamps.** The footer shows when the numbers last *changed*. "Sources & methodology" (also at `#methodology`) adds the last successful data check (read from GitHub's public run history) and the state's own publish time.
- **Polite to the state's servers.** The scraper makes about 3 requests every 2 minutes (the state's own page refreshes every 5) and identifies itself. If the state site ever shows a CAPTCHA, the run fails rather than trying to get around it.
