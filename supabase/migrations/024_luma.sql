-- luma.com/austin was live-verified (curl, no browser/JS) to be a Next.js
-- discover page whose own frontend calls a public, unauthenticated JSON
-- endpoint to fetch/paginate results: api.lu.ma/discover/get-paginated-events.
-- That response is structured enough for a dedicated parser
-- (lib/sources/luma.ts) with no Gemini and no BROWSER_FETCH_URL — same tier
-- as Meetup/Partiful/CultureMap — and, unlike the page's own embedded
-- __NEXT_DATA__, includes each event's ticket_info (price/is_free).
--
-- The page's own `?slug=austin` feed is a curated "Popular events" view
-- capped at 21 (has_more always false, even filtered by any of Luma's 8
-- discover-page category tabs). The same endpoint's `?place_api_id=<id>`
-- param drives a genuinely paginated geo search — live-verified at 120
-- unique Austin-metro events (a strict superset of the 21), so the parser
-- resolves that place id from the page's own __NEXT_DATA__ once per city and
-- paginates on it instead, falling back to the slug feed only if that
-- resolution ever fails.
--
-- `url` here is the human discover page, not the API URL: the parser derives
-- everything it needs from it (mirroring meetup.ts/culturemap.ts's "one
-- human-facing base URL, parser fans out internally" shape), so the row stays
-- a clickable, human-verifiable link like every other source's `url`. Daily
-- cadence matches Meetup/Partiful's own crawl frequency.
INSERT INTO sources (name, kind, url, parser, cadence, notes) VALUES
  ('crawl:luma-com', 'jsonld',
   'https://luma.com/austin',
   'luma', 'daily',
   'luma.com/austin discover page; parser resolves the place_api_id from the page and paginates the public api.lu.ma/discover/get-paginated-events JSON endpoint on it; ~120 unique Austin-metro events, no Gemini');
