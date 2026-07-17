-- Personalized recommendations, part 2: the signal layer.
--
-- Every input the recommender learns from. Two identities can own a signal: a
-- signed-in `user_id` or an anonymous device `anon_id` (the `wid` cookie). Every
-- table therefore carries both, nullable, with a CHECK that exactly one side is
-- present, and partial unique indexes so "one row per (actor, thing)" holds for
-- each identity independently. On sign-in, a merge repoints anon rows to the
-- user (later phase).
--
--   * favorites      — explicit saves (the heart); also the strongest label
--   * user_interests — survey + profile weights, and derived negative signals
--   * interactions   — append-only log of everything that happens
--
-- The explicit save/interested WRITE paths and the survey land in later phases;
-- Phase 1 populates `interactions` (implicit signals) via /api/track. The tables
-- are created together so the schema is coherent in one place.

-- Explicit saves. `interested` (a lighter "this looks good") is a separate
-- interaction type in the log below rather than its own table — only true
-- favorites build the profile's saved list.
CREATE TABLE favorites (
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id    UUID,
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX favorites_user_event ON favorites (user_id, event_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX favorites_anon_event ON favorites (anon_id, event_id) WHERE anon_id IS NOT NULL;
CREATE INDEX favorites_event ON favorites (event_id);

-- Explicit interest weights. Rows with source IN ('onboarding','profile') are
-- always user_id-keyed (the survey is post-authentication); anon_id rows only
-- ever hold source='derived' interests inferred from behavior.
CREATE TABLE user_interests (
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id    UUID,
  kind       TEXT NOT NULL,                 -- 'category' | 'neighborhood' | 'venue' | 'price'
  value      TEXT NOT NULL,                 -- category slug, neighborhood, venue_norm, 'free_only'
  weight     REAL NOT NULL DEFAULT 1.0,     -- negative = "not interested"
  source     TEXT NOT NULL,                 -- 'onboarding' | 'profile' | 'derived'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX user_interests_user ON user_interests (user_id, kind, value) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_interests_anon ON user_interests (anon_id, kind, value) WHERE anon_id IS NOT NULL;

-- Append-only interaction log: implicit signals (view/clickout/share/…) and the
-- explicit ones (favorite/interested/hide) both land here, so training and
-- metrics have one source of truth. `serve_id` links an interaction back to the
-- recommendation impression that produced it (filled once serving ships).
CREATE TABLE interactions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id    UUID,
  city_id    INT REFERENCES cities(id),
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                 -- see lib/recs/config.ts INTERACTION_TYPES
  serve_id   UUID,                          -- links to rec_impressions when recommended
  query      TEXT,                          -- for type='search'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE INDEX interactions_actor ON interactions (user_id, created_at DESC);
CREATE INDEX interactions_anon  ON interactions (anon_id, created_at DESC);
CREATE INDEX interactions_event ON interactions (event_id);
CREATE INDEX interactions_serve ON interactions (serve_id) WHERE serve_id IS NOT NULL;

ALTER TABLE favorites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages favorites"      ON favorites      FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manages user_interests" ON user_interests FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manages interactions"   ON interactions   FOR ALL USING (auth.role() = 'service_role');
