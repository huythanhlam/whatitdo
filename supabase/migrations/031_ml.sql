-- Personalized recommendations, part 3: the model's feature stores + training log.
--
-- There is one ranking system — a logistic-regression model — and it is live
-- from launch. Before any training data exists it serves seeded prior weights
-- (model_versions v1); those priors are a model version like any other, replaced
-- through the same promotion pipeline once nightly training beats them.
--
--   * user_affinity   — per-actor taste, write-through EMA-updated on each signal
--   * event_engagement — Bayesian-smoothed engagement rate per event (real-time)
--   * model_versions  — versioned coefficients; serving reads the active row
--   * rec_impressions — every recommendation served + its feature vector (labels)
--
-- Deferred to the phase that consumes it: the pgvector `events.embedding` column
-- and `user_vectors` (the semantic-similarity feature). PGlite — the zero-config
-- local/dev driver — does not load the `vector` extension, and migrations run
-- verbatim on both drivers, so introducing it here would break local dev for a
-- feature nothing reads yet. The v1 weights below already include an
-- `embedding_sim` coefficient; the scorer treats an absent feature as 0 until
-- that column ships, so adding it later is purely additive.

-- Per-actor affinity, one row per (actor, kind, value). score is an exponential
-- moving average in [0,1] (negative for hides), nudged on every signal.
CREATE TABLE user_affinity (
  user_id     UUID,
  anon_id     UUID,
  kind        TEXT NOT NULL,   -- 'category' | 'venue' | 'neighborhood' | 'price' | 'dow'
  value       TEXT NOT NULL,
  score       REAL NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX user_affinity_user ON user_affinity (user_id, kind, value) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_affinity_anon ON user_affinity (anon_id, kind, value) WHERE anon_id IS NOT NULL;

-- Event quality prior: a Bayesian-smoothed engagement rate, updated write-through
-- so trending is effectively real-time without a cron. impressions rises on each
-- recommendation serve; engagements on each positive signal. New events start at
-- the city average (via the smoothing prior) instead of zero.
CREATE TABLE event_engagement (
  event_id    UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  impressions INT NOT NULL DEFAULT 0,
  engagements INT NOT NULL DEFAULT 0,
  score       REAL NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Versioned model coefficients. Serving reads the single row with status='active'.
-- v1 is the seeded prior; nightly training inserts candidates that get gated and
-- promoted (flip status) or retired — one row, so rollback is a single UPDATE.
-- Created before rec_impressions, which has a FK to it.
CREATE TABLE model_versions (
  id           SERIAL PRIMARY KEY,
  weights      JSONB NOT NULL,
  trained_rows INT NOT NULL DEFAULT 0,   -- 0 for the seeded v1
  holdout_auc  REAL,                     -- null for v1 (no evaluation)
  status       TEXT NOT NULL DEFAULT 'candidate',  -- 'candidate' | 'active' | 'shadow' | 'retired'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed v1 prior weights. MUST stay in sync with V1_MODEL_WEIGHTS in
-- lib/recs/config.ts (a test asserts the active row equals it). Priors are
-- hand-set: a low bias (engagement is rare), strong positive pull from explicit
-- category/venue affinity, and a negative seen_count so already-seen-but-ignored
-- events sink.
INSERT INTO model_versions (weights, status) VALUES (
  '{"bias":-2.0,"category_affinity":2.0,"venue_affinity":1.0,"neighborhood_affinity":0.8,"price_fit":0.5,"dow_affinity":0.3,"engagement_prior":1.5,"embedding_sim":1.2,"proximity":0.4,"seen_count":-0.5}',
  'active'
);

-- Every recommendation served, with the feature vector used to rank it: this is
-- the model's training data. `engaged` is backfilled when an interaction arrives
-- carrying this row's serve_id. Written once serving ships (later phase); the
-- table exists now so the schema and the model registry are coherent together.
CREATE TABLE rec_impressions (
  id            BIGSERIAL PRIMARY KEY,
  serve_id      UUID NOT NULL,        -- one per /api/recommendations response
  user_id       UUID,
  anon_id       UUID,
  city_id       INT NOT NULL REFERENCES cities(id),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  surface       TEXT NOT NULL,        -- 'rail' | 'for_you' | 'digest'
  position      INT NOT NULL,         -- rank shown; needed for position-bias correction
  features      JSONB NOT NULL,       -- feature vector at serve time, exactly as scored
  model_version INT NOT NULL REFERENCES model_versions(id),
  explored      BOOLEAN NOT NULL DEFAULT false,
  engaged       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX rec_impressions_serve ON rec_impressions (serve_id);
CREATE INDEX rec_impressions_day   ON rec_impressions (created_at);

ALTER TABLE user_affinity    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec_impressions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages user_affinity"    ON user_affinity    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manages event_engagement" ON event_engagement FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manages rec_impressions"  ON rec_impressions  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manages model_versions"   ON model_versions   FOR ALL USING (auth.role() = 'service_role');
