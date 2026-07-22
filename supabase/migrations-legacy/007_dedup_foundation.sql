-- Phase 2A: canonical events + cross-source provenance + trigram dedup.
-- The same concert from two sources becomes ONE events row with two
-- event_sources rows, instead of two duplicate events.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Minimal cities scaffold. Full [city] routing is Phase 3; this exists now so
-- events/sources can carry city_id and the dedup block index matches the spec.
CREATE TABLE cities (
  id       SERIAL PRIMARY KEY,
  slug     TEXT UNIQUE NOT NULL,
  name     TEXT NOT NULL,
  state    TEXT NOT NULL DEFAULT 'TX',
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  lat      NUMERIC,
  lng      NUMERIC,
  enabled  BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO cities (slug, name) VALUES ('austin', 'Austin');

-- events becomes canonical: add city + normalized match keys.
ALTER TABLE events ADD COLUMN city_id    INT REFERENCES cities(id);
ALTER TABLE events ADD COLUMN title_norm TEXT;
ALTER TABLE events ADD COLUMN venue_norm TEXT;

-- Backfill existing rows to Austin, then enforce + default.
UPDATE events SET city_id = (SELECT id FROM cities WHERE slug = 'austin')
WHERE city_id IS NULL;
ALTER TABLE events ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE events ALTER COLUMN city_id SET DEFAULT 1;

-- Per-source provenance. external_id is the old events.source_id; the
-- (source, external_id) primary key preserves exactly the dedup key that
-- events.UNIQUE(source, source_id) used to enforce, and becomes a source_id FK
-- in Phase 2B (mirrors source_runs.source).
CREATE TABLE event_sources (
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url         TEXT,
  raw         JSONB,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_id)
);
CREATE INDEX event_sources_event ON event_sources(event_id);

-- Backfill provenance from existing events (one row each). COALESCE guards the
-- nullable legacy source_id; a UUID cast can't collide with a real external id.
INSERT INTO event_sources (event_id, source, external_id, url)
SELECT id, source, COALESCE(source_id, id::text), ticket_url FROM events;

-- Drop the constraint that blocked cross-source collapse. Named guard is safe on
-- both drivers (Postgres default constraint name is <table>_<cols>_key).
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_source_id_key;

-- Dedup indexes: block by (city, date, venue), score by title trigram similarity.
-- start_time::date alone depends on the session TimeZone GUC, so Postgres
-- refuses it in an index expression (not provably IMMUTABLE); AT TIME ZONE with
-- an explicit zone name pins the conversion and IS marked IMMUTABLE.
CREATE INDEX events_dedup_block ON events (city_id, ((start_time AT TIME ZONE 'UTC')::date), venue_norm);
CREATE INDEX events_title_trgm  ON events USING GIN (title_norm gin_trgm_ops);

-- RLS parity with the existing tables.
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read cities" ON cities FOR SELECT USING (true);

ALTER TABLE event_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read event_sources" ON event_sources FOR SELECT USING (true);
CREATE POLICY "Service role write event_sources" ON event_sources
  FOR ALL USING (auth.role() = 'service_role');
