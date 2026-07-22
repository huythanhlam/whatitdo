-- meanwhilebeer.com/events was live-verified (curl, no browser) to be a
-- Webflow CMS collection list, statically server-rendered, with each item's
-- own event-specific flyer image baked into its `background-image` style and
-- pagination via the list's own "Next" link (4 pages, ~80 events). That's
-- structured enough for a dedicated parser (lib/sources/meanwhile.ts) that
-- walks every page to exhaustion and captures each event's image — no
-- Gemini, no BROWSER_FETCH_URL — replacing the generic single-page 'crawl'
-- parser this source launched with in 010_austin_venues.sql, which only ever
-- saw whatever fit on page 1 and dropped every event's image. `kind` moves
-- from 'crawl' (Gemini-extracted, trust tier 1) to 'jsonld' (structured/
-- exact, trust tier 2) to match the other no-Gemini structured sources
-- (culturemap, meetup, luma, partiful).
UPDATE sources
SET parser = 'meanwhile', kind = 'jsonld'
WHERE name = 'crawl:meanwhilebrewing-com';
