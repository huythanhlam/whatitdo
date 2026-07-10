-- Venue header-image cache, keyed by (city_id, venue_norm) — same lookaside
-- pattern as migration 014's `venues` geocode cache, but for the venue's own
-- website header image (og:image/twitter:image). Used as the fallback image
-- when an ingested event carries none of its own (see lib/venueImage.ts):
-- every event still shows a real, source-derived image instead of a generic
-- category stock photo whenever the venue's site has one.
CREATE TABLE venue_images (
  city_id     INT NOT NULL REFERENCES cities(id),
  venue_norm  TEXT NOT NULL,
  venue_name  TEXT NOT NULL,
  -- NULL means "checked, the venue's site had no usable header image" — still
  -- cached so we don't refetch on every event at that venue.
  image_url   TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, venue_norm)
);

ALTER TABLE venue_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read venue_images" ON venue_images FOR SELECT USING (true);
CREATE POLICY "Service role write venue_images" ON venue_images
  FOR ALL USING (auth.role() = 'service_role');
