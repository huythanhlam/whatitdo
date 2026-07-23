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
