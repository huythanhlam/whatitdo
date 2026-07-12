-- Per-source override for 'crawl-paginated''s page count (see
-- lib/sources/paginated-crawl.ts). Needed because the shared 2-page default
-- means genuinely complete coverage for Chronicle's Staff Pick view (85
-- events total) but would be a small, unlabeled sample of Chronicle's Live
-- Music calendar (1,626 events / 41 pages, live-verified). Null = parser's
-- own default.
ALTER TABLE sources ADD COLUMN max_pages INTEGER;

-- Austin Chronicle Live Music calendar: same domain/mechanism as Staff
-- Picks (calendar.austinchronicle.com, 403s on a plain fetch — Cloudflare JS
-- challenge — needs BROWSER_FETCH_URL, so 'crawl-paginated' + weekly cadence
-- to match the other BROWSER_FETCH_URL-dependent sources). Results are
-- sorted by date but NOT evenly distributed across it (small club listings
-- dominate the near term, then thin out to just pre-announced big-venue
-- shows) — live-checked page-by-page: page 10 -> Jul 16, page 20 -> Jul
-- 23-24, page 30 -> Aug 4-8, page 32 -> Aug 9-18. 32 pages (~1,250 events)
-- was the smallest page count that cleared "at least one month out" (Aug
-- 10) with a buffer, rather than a round number. This mapping will drift as
-- the source's own backlog changes, so it's an approximation, not a
-- guarantee — re-check page-by-page if a full month of coverage matters
-- again later. 32 pages = 32 Gemini extraction calls per run (one per
-- page), but only once a week, so weekly cadence keeps this well inside the
-- default 200/day Gemini budget alongside every other source.
INSERT INTO sources (name, kind, url, parser, cadence, max_pages, notes) VALUES
  ('crawl:calendar-austinchronicle-com-music', 'crawl',
   'https://calendar.austinchronicle.com/austin/EventSearch?eventSection=2163369&sortType=date&v=g',
   'crawl-paginated', 'weekly', 32,
   'roundup; live music calendar, 1,626 events/41 pages total — 32-page (~1,250 event) sample covering at least a month out, needs BROWSER_FETCH_URL');

-- Austin Chronicle Staff Picks (crawl:calendar-austinchronicle-com) and
-- Community Impact (crawl:atxevents-communityimpact-com) were already added
-- in 019/020_*.sql — atxevents.communityimpact.com/ redirects to the exact
-- /calendars/all-events URL already configured, live-verified, no change
-- needed.
