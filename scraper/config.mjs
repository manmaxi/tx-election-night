// Single source of truth for what the scraper looks for and what the page shows.
// Candidates are listed alphabetically by last name; the page re-sorts by votes once results arrive.
// Names match the official ballot as staged in the state's results system. Any candidate not listed here
// (third-party and write-in candidates) is counted in "All others", so every percentage is a share of all votes.
// Photos: site/img/<id>.jpg, cropped from freely licensed Wikimedia Commons files; photoCredit is shown in the footer
// (the CC BY-SA licenses require it, and the crops are shared under the same license).

export const ELECTION = {
  date: '2026-11-03',
  pollsCloseCT: '2026-11-03T19:00:00-06:00',
  sourceName: 'Texas Secretary of State · unofficial election night returns',
  sourceUrl: 'https://goelect.txelections.civixapps.com/ivis-enr-ui/races',
  // The state's results system lists this election under this name and id (checked Oct 16, 2026).
  civixName: /^2026 NOVEMBER GENERAL ELECTION$/i,
  civixId: 53815,
};

export const RACES = [
  {
    id: 'senate',
    title: 'U.S. Senate',
    match: /^U\.?\s?S\.?\s+SENATOR$/i,
    candidates: [
      { id: 'paxton', name: 'Ken Paxton', party: 'R', match: /\bPAXTON\b/i,
        photoCredit: { by: 'Gage Skidmore', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', source: 'https://commons.wikimedia.org/wiki/File:Ken_Paxton_2024_(cropped).jpg' } },
      { id: 'talarico', name: 'James Talarico', party: 'D', match: /\bTALARICO\b/i,
        photoCredit: { by: 'Antonioaesparza', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', source: 'https://commons.wikimedia.org/wiki/File:James_Talarico_Press_Conference_3x4_(cropped).jpg' } },
      { id: 'other', name: 'All others', party: 'O' },
    ],
  },
  {
    id: 'governor',
    title: 'Governor',
    match: /^GOVERNOR$/i,
    candidates: [
      { id: 'abbott', name: 'Greg Abbott', party: 'R', match: /\bABBOTT\b/i,
        photoCredit: { by: 'NASA / Robert Markowitz', license: 'public domain', source: 'https://commons.wikimedia.org/wiki/File:Greg_Abbott_2024_(cropped).jpg' } },
      { id: 'hinojosa', name: 'Gina Hinojosa', party: 'D', match: /\bHINOJOSA\b/i,
        photoCredit: { by: 'Pointsoforder', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', source: 'https://commons.wikimedia.org/wiki/File:Reps._Gonzalez,_Hinojosa,_Howard.jpg' } },
      { id: 'other', name: 'All others', party: 'O' },
    ],
  },
];

// Optional: big counties' own results pages, which sometimes post before the state feed.
// Each is opened in a headless browser and read with the generic extractor (extract.mjs).
// For each county the scraper keeps whichever source has counted more ballots.
export const COUNTY_SOURCES = [
  // { id: 'dallas', fips: '48113', url: 'https://...' },
  // { id: 'harris', fips: '48201', url: 'https://...' },
  // { id: 'tarrant', fips: '48439', url: 'https://...' },
  // { id: 'bexar', fips: '48029', url: 'https://...' },
  // { id: 'travis', fips: '48453', url: 'https://...' },
  // { id: 'collin', fips: '48085', url: 'https://...' },
];
