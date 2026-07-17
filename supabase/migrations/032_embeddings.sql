-- Personalized recommendations, part 4: the semantic feature.
--
-- Gives the ranking model a content-similarity signal: how close an event's text
-- is to the actor's taste. Deferred from the earlier ML migration because it's
-- only consumed once serving ships (this phase).
--
-- Storage is a plain REAL[] (a 768-d embedding), NOT pgvector. PGlite — the
-- zero-config local/dev driver — loads no `vector` extension, and migrations run
-- verbatim on both drivers. Cosine similarity is computed in TypeScript over the
-- candidate set (a few hundred upcoming events per request), which is trivial at
-- this scale and keeps one schema for both drivers. If catalog size ever makes an
-- ANN index worthwhile, this column can migrate to pgvector on Postgres behind
-- the same lib/recs/embed.ts seam.

-- Per-event content embedding, filled by the backfill script / a later cron via
-- Gemini. NULL until embedded; the scorer treats a missing embedding as "no
-- semantic signal" (feature contributes 0), so this is safe to roll out lazily.
ALTER TABLE events ADD COLUMN embedding REAL[];

-- Per-actor taste vector: a decayed running mean of the embeddings of events the
-- actor engaged with, seeded from survey categories (later phase). One row per
-- actor, keyed like every other signal table (user_id XOR anon_id).
CREATE TABLE user_vectors (
  user_id    UUID,
  anon_id    UUID,
  vec        REAL[] NOT NULL,
  n          INT NOT NULL DEFAULT 0,   -- observations blended in, for the running mean
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX user_vectors_user ON user_vectors (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_vectors_anon ON user_vectors (anon_id) WHERE anon_id IS NOT NULL;

ALTER TABLE user_vectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages user_vectors" ON user_vectors FOR ALL USING (auth.role() = 'service_role');
