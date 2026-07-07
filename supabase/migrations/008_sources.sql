-- Phase 2B: config-driven sources. Ingestion instances (which feeds/venues/APIs
-- to crawl) move from hardcoded code lists into this table; code holds only the
-- parser MECHANISMS, dispatched by the `parser` column. Adding coverage becomes
-- an INSERT, not a pull request (PRODUCT-SPEC §1.2).
CREATE TABLE sources (
  id           SERIAL PRIMARY KEY,
  city_id      INT NOT NULL REFERENCES cities(id) DEFAULT 1,
  name         TEXT NOT NULL UNIQUE,   -- also the RawEvent.source string this row emits
  kind         TEXT NOT NULL,          -- api | ical | rss | jsonld | crawl
  url          TEXT,                   -- null for env-configured api/jsonld kinds
  parser       TEXT NOT NULL,          -- key into the code PARSERS registry
  cadence      TEXT NOT NULL DEFAULT 'daily',   -- daily | weekly
  enabled      BOOLEAN NOT NULL DEFAULT true,
  last_success TIMESTAMPTZ,
  content_hash TEXT,                   -- skip Gemini when a crawled page is unchanged
  notes        TEXT
);
CREATE INDEX sources_city_enabled ON sources (city_id, enabled);

-- Seed today's sources — one row per instance. `name` matches the exact string
-- each parser already emits as RawEvent.source, so provenance/runs link back by
-- name (see migration 009) with zero code churn.

-- Structured APIs / JSON-LD (no url; configured by env keys + city geo).
INSERT INTO sources (name, kind, url, parser) VALUES
  ('eventbrite',    'jsonld', NULL, 'eventbrite'),
  ('ticketmaster',  'api',    NULL, 'ticketmaster'),
  ('seatgeek',      'api',    NULL, 'seatgeek'),
  ('youtube',       'api',    NULL, 'youtube'),
  ('social:bluesky','crawl',  NULL, 'bluesky');

-- Government iCal.
INSERT INTO sources (name, kind, url, parser) VALUES
  ('austin-gov', 'ical', 'https://www.austintexas.gov/calendar/ical', 'ical');

-- Newspaper / news RSS (each was an entry in newspapers.ts NEWSPAPER_FEEDS).
INSERT INTO sources (name, kind, url, parser) VALUES
  ('newspaper:kut',              'rss', 'https://www.kut.org/tags/events.rss', 'rss'),
  ('newspaper:austin-monitor',   'rss', 'https://www.austinmonitor.com/feed/', 'rss'),
  ('newspaper:daily-texan',      'rss', 'https://thedailytexan.com/feed/', 'rss'),
  ('newspaper:towers',           'rss', 'https://austin.towers.net/feed/', 'rss'),
  ('newspaper:kvue',             'rss', 'https://www.kvue.com/feeds/syndication/rss/news/local', 'rss'),
  ('newspaper:eater-austin',     'rss', 'https://austin.eater.com/rss/index.xml', 'rss'),
  ('newspaper:kxan',             'rss', 'https://www.kxan.com/feed/', 'rss'),
  ('newspaper:community-impact', 'rss', 'https://communityimpact.com/rss/', 'rss'),
  ('newspaper:fox7-austin',      'rss', 'https://www.fox7austin.com/rss/category/local-news', 'rss');

-- Reddit per-subreddit Atom feeds (each was in social.ts REDDIT_FEEDS). The .rss
-- endpoints are plain Atom, so the generic rss parser handles them.
INSERT INTO sources (name, kind, url, parser) VALUES
  ('social:reddit-austinevents', 'rss', 'https://www.reddit.com/r/AustinEvents/.rss', 'rss'),
  ('social:reddit-austin',       'rss', 'https://www.reddit.com/r/Austin/.rss', 'rss');

-- Media-roundup crawl pages (each was in crawler.ts DEFAULT_CRAWL_URLS). Names
-- match the crawler's hostSlug(url) so historical provenance backfills cleanly.
INSERT INTO sources (name, kind, url, parser, cadence) VALUES
  ('crawl:do512-com',           'crawl', 'https://do512.com/', 'crawl', 'daily'),
  ('crawl:365thingsaustin-com', 'crawl', 'https://365thingsaustin.com/', 'crawl', 'daily'),
  ('crawl:austinchronicle-com', 'crawl', 'https://www.austinchronicle.com/events/', 'crawl', 'daily');

-- RLS parity with existing tables: public read, service-role write.
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read sources" ON sources FOR SELECT USING (true);
CREATE POLICY "Service role write sources" ON sources
  FOR ALL USING (auth.role() = 'service_role');
