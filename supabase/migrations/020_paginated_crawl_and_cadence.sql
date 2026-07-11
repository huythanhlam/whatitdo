-- Point Chronicle at the curated, chronologically-sorted Staff Pick view
-- (85 unique events across 2 pages, live-verified) instead of the general
-- calendar (2,382 results / 60 pages, mostly low-value/recurring listings,
-- and where a single-page fetch only ever surfaced ~4 events). 2 pages of
-- the Staff Pick view is COMPLETE coverage, not a sample, so route it
-- through the new multi-page 'crawl-paginated' mechanism.
UPDATE sources
SET url = 'https://calendar.austinchronicle.com/austin/EventSearch?feature=Staff+Pick&sortType=date&v=g',
    parser = 'crawl-paginated'
WHERE name = 'crawl:calendar-austinchronicle-com';

-- All 4 sources that depend on BROWSER_FETCH_URL to produce any events at
-- all move to weekly cadence, keeping Firecrawl-credit and Gemini-request
-- usage proportional to their cost (Chronicle now fetches 2 pages/run
-- instead of 1).
UPDATE sources SET cadence = 'weekly'
WHERE name IN (
  'crawl:calendar-austinchronicle-com',
  'crawl:6amcity-com',
  'crawl:atxevents-communityimpact-com',
  'crawl:texasperformingarts-org'
);
