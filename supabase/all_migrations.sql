-- Categories lookup table
CREATE TABLE categories (
  id   SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

INSERT INTO categories (slug, name, color) VALUES
  ('music',        'Music',          '#7c3aed'),
  ('comedy',       'Comedy',         '#ea580c'),
  ('food-drink',   'Food & Drink',   '#16a34a'),
  ('arts',         'Arts',           '#0284c7'),
  ('sports',       'Sports',         '#dc2626'),
  ('family',       'Family',         '#d97706'),
  ('festivals',    'Festivals',      '#db2777'),
  ('film',         'Film',           '#475569'),
  ('outdoors',     'Outdoors',       '#15803d'),
  ('networking',   'Networking',     '#6d28d9'),
  ('other',        'Other',          '#71717a');

-- Main events table
CREATE TABLE events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ,
  venue_name    TEXT,
  venue_address TEXT,
  image_url     TEXT,
  ticket_url    TEXT,
  source        TEXT NOT NULL,
  source_id     TEXT,
  is_free       BOOLEAN DEFAULT false,
  price_min     NUMERIC(10,2),
  price_max     NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, source_id)
);

-- Many-to-many events <-> categories
CREATE TABLE event_categories (
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, category_id)
);

-- Full-text search index
CREATE INDEX events_fts ON events USING GIN (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(venue_name, ''))
);

CREATE INDEX events_start_time ON events(start_time);

-- Row Level Security
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read events" ON events FOR SELECT USING (true);
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Public read event_categories" ON event_categories FOR SELECT USING (true);

CREATE POLICY "Service role write events" ON events FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role write event_categories" ON event_categories FOR ALL USING (auth.role() = 'service_role');
CREATE TABLE subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency      TEXT NOT NULL DEFAULT 'daily',
  category_slugs TEXT[] DEFAULT '{}',
  token          TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  confirmed      BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages subscriptions" ON subscriptions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Users read own subscriptions" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
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
-- Grant table privileges to the Supabase API roles.
-- Required when "permission denied for table ..." appears even with the
-- service_role key: RLS policies control row access, but the roles still need
-- base table GRANTs underneath them.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- service_role (server-side, bypasses RLS) needs full access
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- anon + authenticated need read access (public event browsing); writes are
-- still gated by the RLS policies from 001/002/003.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Apply the same grants automatically to any tables created later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
