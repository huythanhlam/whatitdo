-- Phase 4: map view. Venue data is denormalized on events (venue_name,
-- venue_address, venue_norm — the last from migration 007's dedup blocking),
-- so this is a lookaside geocode cache keyed by (city_id, venue_norm),
-- populated once per unique venue by ingest/backfill and joined against
-- events at read time for the map (PRODUCT-SPEC.md: "Requires geocoding
-- venue_address at persist time (cache by venue_norm)").
CREATE TABLE venues (
  city_id           INT NOT NULL REFERENCES cities(id),
  venue_norm        TEXT NOT NULL,
  venue_name        TEXT NOT NULL,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION,
  formatted_address TEXT,
  status            TEXT NOT NULL CHECK (status IN ('ok', 'zero_results', 'error')),
  -- True once this venue was geocoded using a real venue_address (not just the
  -- venue_name + city fallback). Lets ensureVenueGeocoded upgrade a name-only
  -- geocode exactly once, the first time an address becomes available for this
  -- venue_norm, instead of caching the coarser result forever.
  used_address      BOOLEAN NOT NULL DEFAULT false,
  geocoded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, venue_norm)
);

-- The map only ever reads 'ok' rows; a partial index keeps that lookup small
-- as 'zero_results'/'error' rows accumulate for permanently-unmappable venues.
CREATE INDEX venues_ok ON venues (city_id) WHERE status = 'ok';

-- RLS parity with existing tables: public read, service-role write.
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read venues" ON venues FOR SELECT USING (true);
CREATE POLICY "Service role write venues" ON venues
  FOR ALL USING (auth.role() = 'service_role');
