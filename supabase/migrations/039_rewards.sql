-- Virtual rewards: badges + points + levels.
--
-- Design (see docs / plan): badge *definitions* live in code
-- (lib/rewards/catalog.ts) — versioned in git, no migration to add an
-- achievement. This table records only WHICH badges a user has earned and WHEN.
-- Points and level are DERIVED (lib/rewards/engine.ts) from the interaction
-- history + this table, never stored.
--
-- Post-cutover tier (>033): like the rest of the personalization stack this
-- references auth.users and uses real per-user RLS, so it is applied by the
-- Supabase stack (and the rls.integration.test harness), NOT the legacy PGlite
-- dev runner. Reads degrade gracefully when the table is absent (see
-- lib/rewards/data.ts).

CREATE TABLE user_badges (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id   TEXT NOT NULL,               -- matches a BadgeDef.id in the code catalog
  points     INT  NOT NULL DEFAULT 0,     -- snapshot of the badge's value at award time
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX user_badges_user ON user_badges (user_id);

-- Per-user privacy: a user sees and writes only their own awards (same pattern as
-- migration 035). The composite PK means no sequence, so no sequence grant needed.
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own badges" ON user_badges
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON user_badges TO authenticated;
REVOKE SELECT ON user_badges FROM anon;
