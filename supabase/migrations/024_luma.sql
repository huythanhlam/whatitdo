-- luma.com/austin was live-verified (curl, no browser/JS) to be a Next.js
-- discover page whose own frontend calls a public, unauthenticated JSON
-- endpoint to fetch/paginate results:
-- api.lu.ma/discover/get-paginated-events?slug=austin. That response is
-- structured enough for a dedicated parser (lib/sources/luma.ts) with no
-- Gemini and no BROWSER_FETCH_URL — same tier as Meetup/Partiful/CultureMap
-- — and, unlike the page's own embedded __NEXT_DATA__, includes each event's
-- ticket_info (price/is_free), plus has_more/next_cursor pagination.
--
-- `url` here is the human discover page, not the API URL: the parser derives
-- the city slug from its path (mirroring meetup.ts/culturemap.ts's "one
-- human-facing base URL, parser fans out internally" shape), so the row stays
-- a clickable, human-verifiable link like every other source's `url`. Live-
-- verified at 21 upcoming Austin events in a single page (has_more: false).
-- Daily cadence matches Meetup/Partiful's own crawl frequency.
INSERT INTO sources (name, kind, url, parser, cadence, notes) VALUES
  ('crawl:luma-com', 'jsonld',
   'https://luma.com/austin',
   'luma', 'daily',
   'luma.com/austin discover page; parser hits the public api.lu.ma/discover/get-paginated-events?slug=austin JSON endpoint directly, cursor-paginated; ~21 upcoming Austin events, no Gemini');
