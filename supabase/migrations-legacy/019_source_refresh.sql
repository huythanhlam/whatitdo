-- Austin source refresh — live-verified 2026-07-10. The three original
-- "roundup" crawlers from migration 008 and the austin-gov iCal feed no longer
-- produce events:
--   crawl:do512-com          -> HTTP 403 (do512.com now redirects into 6AM
--                                City's ATXtoday network, which acquired it)
--   crawl:austinchronicle-com -> HTTP 403, Cloudflare bot-check challenge page
--   austin-gov (ical)         -> HTTP 404, the /calendar/ical endpoint is dead
-- Disabled rather than deleted so historical source_runs/event_sources
-- provenance keeps its FK (same convention as every other source edit here —
-- sources are never hard-deleted, see the Phase 2B plan).
UPDATE sources
SET enabled = false,
    notes = trim(both '; ' from concat_ws('; ', notes, 'disabled 2026-07-10: blocked/dead, superseded by newer sources below'))
WHERE name IN ('crawl:do512-com', 'crawl:austinchronicle-com', 'austin-gov');

-- Two existing roundup sources are alive but were pointed at pages with no
-- event data; repoint at their real events pages. Both publish schema.org
-- Event JSON-LD directly on that page, so switch them onto the new
-- Gemini-free 'events-jsonld' parser too.
UPDATE sources
SET url = 'https://365thingsaustin.com/events', kind = 'jsonld', parser = 'events-jsonld'
WHERE name = 'crawl:365thingsaustin-com';

UPDATE sources
SET url = 'https://thelongcenter.org/upcoming-calendar/', kind = 'jsonld', parser = 'events-jsonld'
WHERE name = 'crawl:thelongcenter-org';

-- Texas Performing Arts: same crawl parser, just the correct calendar path.
UPDATE sources
SET url = 'https://texasperformingarts.org/events/calendar/'
WHERE name = 'crawl:texasperformingarts-org';

-- New Austin roundup coverage. Each was live-checked (including rendering in
-- a real browser, not just a raw HTTP fetch) for the right mechanism:
--   austintexas.org — Simpleview CMS: its events widget calls a public,
--     unauthenticated JSON REST API (found via the widget's own network
--     calls) with 3000+ events — dedicated 'simpleview' parser, no Gemini,
--     no browser needed at request time. `url` is the site origin.
--   austintexas.gov/events — Drupal site: the index page is an ItemList of
--     event-page URLs, and every event page embeds a full schema.org Event —
--     'events-jsonld' follows the list and reads each detail page, no Gemini.
--   calendar.austinchronicle.com / 6amcity.com / atxevents.communityimpact.com
--     / texasperformingarts.org/events/calendar — confirmed (via a real
--     rendered browser session) to carry genuine event listings, but each
--     needs JS execution to produce it (Cloudflare's non-interactive browser
--     check on Chronicle; Next.js RSC streaming on 6amcity; a Scenethink JS
--     widget on Community Impact; a WP ShowPro AJAX widget on TPA) — none of
--     that is available to a plain server-side fetch, so these stay on the
--     generic Gemini-extraction crawler and need BROWSER_FETCH_URL configured
--     (a headless-render service) to actually produce events in production.
--   austin.culturemap.com / statesman.com — real static HTML, generic crawler
--     is the right fit; culturemap in particular is a day-at-a-time view (one
--     event per fetch), so its yield-per-crawl is inherently low.
--   partiful.com/explore/atx — Next.js SSR page with every event's full data
--     embedded in __NEXT_DATA__ — dedicated 'partiful' parser, no Gemini.
INSERT INTO sources (name, kind, url, parser, cadence, notes) VALUES
  ('crawl:austintexas-org',              'api',    'https://www.austintexas.org',                                  'simpleview',   'daily',  'roundup; public Simpleview REST API, no Gemini'),
  ('crawl:austintexas-gov',              'jsonld', 'https://www.austintexas.gov/events',                           'events-jsonld','daily',  'gov; replaces dead austin-gov ical feed'),
  ('crawl:calendar-austinchronicle-com', 'crawl',  'https://calendar.austinchronicle.com/austin/EventSearch?v=g',  'crawl',        'daily',  'roundup; confirmed real events behind a Cloudflare JS challenge, needs BROWSER_FETCH_URL'),
  ('crawl:6amcity-com',                  'crawl',  'https://6amcity.com/tx/austin/events',                         'crawl',        'daily',  'roundup; replaces do512 (acquired by 6AM City/ATXtoday); Next.js RSC page, needs BROWSER_FETCH_URL'),
  ('crawl:atxevents-communityimpact-com','crawl',  'https://atxevents.communityimpact.com/calendars/all-events',   'crawl',        'daily',  'roundup; confirmed real events, JS-rendered calendar widget, needs BROWSER_FETCH_URL'),
  ('crawl:austin-culturemap-com',        'crawl',  'https://austin.culturemap.com/events/',                        'crawl',        'daily',  'roundup; day-at-a-time page, low yield per crawl'),
  ('crawl:statesman-com',                'crawl',  'https://www.statesman.com/entertainment/things-to-do/',        'crawl',        'weekly', 'roundup'),
  ('crawl:partiful-com',                 'jsonld', 'https://partiful.com/explore/atx',                             'partiful',     'daily',  'roundup');

-- Texas Performing Arts' calendar events (confirmed real, via a rendered
-- browser) come from a WP "ShowPro" plugin's admin-ajax.php calls, not static
-- HTML — same BROWSER_FETCH_URL dependency as the sources above.
UPDATE sources
SET notes = trim(both '; ' from concat_ws('; ', notes, 'confirmed real events but JS-rendered (WP ShowPro plugin), needs BROWSER_FETCH_URL'))
WHERE name = 'crawl:texasperformingarts-org';
