-- Luma also publishes each discover place as a plain .ics feed
-- (api.luma.com/ics/get?entity=discover&id=<discplace-id>), no auth, no
-- __NEXT_DATA__ scraping needed — the generic `ical` parser (lib/sources/ical.ts)
-- already handles it. Live-verified via curl: this feed's own
-- X-WR-CALNAME is "What's Happening in Austin" and every one of its ~28
-- VEVENTs carries either an "Austin, TX" LOCATION or no address at all
-- (an online event) — none of the other-city leakage that motivated the
-- place_api_id-driven JSON API's (crawl:luma-com, migration 024) new
-- target-state filter in lib/sources/luma.ts. Kept as a separate row (not a
-- replacement for crawl:luma-com) since its ~28 events only partially
-- overlap that feed's ~120 — extra coverage, not a duplicate; lib/dedup.ts
-- merges any event both sources see.
INSERT INTO sources (name, kind, url, parser, cadence, notes) VALUES
  ('crawl:luma-ics-austin', 'ical',
   'https://api.luma.com/ics/get?entity=discover&id=discplace-0tPy8KGz3xMycnt',
   'ical', 'daily',
   'Luma''s own .ics export of the Austin discover place; live-verified Austin-only, complements crawl:luma-com''s larger JSON-API feed');
