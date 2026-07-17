-- Personalized recommendations, part 1: lightweight accounts.
--
-- The app has had no end-user identity — the email token in `subscriptions` was
-- the only "user". Personalization needs something to attach signals to. This
-- migration adds a minimal, password-less account model:
--   * users        — one row per person, created on first magic-link verify
--   * auth_tokens  — single-use magic-link tokens (Resend delivers the link)
--   * sessions     — opaque session ids stored in an httpOnly cookie
--
-- Auth itself (the /api/auth routes, the sign-in UI) is wired in a later phase;
-- the tables land now because the signal tables in 030 reference users(id). Rows
-- stay empty until accounts ship. Anonymous visitors are identified by a signed
-- `wid` cookie (no DB row) and their signals carry an anon_id instead.
--
-- Note: `subscriptions.user_id` still references the Supabase-native auth.users
-- (migration 002). It is repointed to this table when the auth routes land, so
-- digest identity and account identity converge; not touched here to keep this
-- migration additive.

CREATE TABLE users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT NOT NULL UNIQUE,
  display_name             TEXT,
  home_city_id             INT REFERENCES cities(id),
  onboarded_at             TIMESTAMPTZ,        -- null until the survey is completed or skipped
  personalization_opt_out  BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_tokens (
  token        TEXT PRIMARY KEY,               -- random 32-byte hex, supplied by the app
  email        TEXT NOT NULL,
  wants_digest BOOLEAN NOT NULL DEFAULT false, -- registration checkbox, applied at verify
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ                      -- set when consumed; single-use
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                 -- random 32-byte hex, stored in the session cookie
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);

-- The app connects as service_role and bypasses RLS; these policies exist so the
-- posture matches subscriptions (002) — nothing reachable by the anon API role.
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages users"       ON users       FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manages auth_tokens" ON auth_tokens FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manages sessions"    ON sessions    FOR ALL USING (auth.role() = 'service_role');
