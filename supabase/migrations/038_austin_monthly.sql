-- Austin Monthly's events calendar (austinmonthly.com/calendar/) as a
-- first-class daily source. It's a WordPress "Event Calendar Pro" custom
-- calendar: the listing loads 10 events at a time behind an admin-ajax
-- "load more" action (austin_get_more_events), and every event publishes a
-- full schema.org Event JSON-LD block on its own /events/<slug>/ page. The
-- 'austinmonthly' parser (lib/sources/austinmonthly.ts) does two structured
-- passes — paginate the AJAX endpoint for all detail-page URLs across a
-- rolling ~5-week window, then read each page's JSON-LD — so it spends no
-- Gemini (kind 'jsonld', exact and free). max_pages bounds the listing crawl
-- at 40 pages (~400 events); the live window runs ~250 events/month.
--
-- Reader-submitted community events dominate this calendar, so it overlaps
-- heavily with the other Austin roundup sources; persistEvents' title+venue
-- dedup collapses those against events already ingested from Eventbrite,
-- Chronicle, CultureMap, etc. rather than double-listing them.
INSERT INTO sources (name, kind, url, parser, cadence, max_pages, notes) VALUES
  ('crawl:austinmonthly-com', 'jsonld',
   'https://www.austinmonthly.com/calendar/',
   'austinmonthly', 'daily', 40,
   'roundup; WP Event Calendar Pro, admin-ajax load-more pagination + per-event schema.org JSON-LD detail pages, no Gemini; rolling ~5-week window');
