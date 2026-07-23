-- meetup.com/find/ was live-verified (curl, no browser/JS) to be server-
-- rendered: the page's <script id="__NEXT_DATA__"> embeds a full Apollo
-- GraphQL cache of the search results (props.pageProps.__APOLLO_STATE__),
-- structured enough for a dedicated parser (lib/sources/meetup.ts) with no
-- Gemini and no BROWSER_FETCH_URL — same tier as CultureMap. Meetup's own
-- public API was deprecated in 2019 (now per-user OAuth only), so this find
-- page — itself listed in meetup.com/robots.txt's find-usa-index-sitemap.xml
-- — is the only unauthenticated path to Meetup's event data.
--
-- The bare URL below only returns Meetup's personalized "recommended nearby"
-- feed, a fixed ~11 events regardless of search radius. The parser sweeps it
-- plus one `&keywords=<topic>` page per lib/sources/meetup.ts's
-- TOPIC_KEYWORDS (Meetup's own top-level category tabs), merging results —
-- live-verified at 289 unique Austin events across the 16-topic sweep, vs. 11
-- from the bare page alone. `url` here is just the sweep's base (location +
-- source); the topic fan-out is a parser-internal constant, matching how
-- culturemap.ts's 14-day sweep is driven by one base URL, not one DB row per
-- day. Daily cadence keeps it fresh at ~17 fetches/day, well within what a
-- background crawl of a single site can reasonably do.
INSERT INTO sources (name, kind, url, parser, cadence, notes) VALUES
  ('crawl:meetup-com', 'jsonld',
   'https://www.meetup.com/find/?location=us--tx--austin&source=EVENTS',
   'meetup', 'daily',
   'meetup.com/find/, swept across 16 topic keywords (lib/sources/meetup.ts TOPIC_KEYWORDS); ~289 unique Austin events, structured __NEXT_DATA__ scrape, no Gemini');
