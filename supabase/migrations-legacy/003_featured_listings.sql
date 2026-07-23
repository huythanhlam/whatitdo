CREATE TABLE featured_listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  ad_label    TEXT DEFAULT 'Featured',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE featured_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read featured" ON featured_listings FOR SELECT USING (true);
CREATE POLICY "Service role write featured" ON featured_listings FOR ALL USING (auth.role() = 'service_role');
