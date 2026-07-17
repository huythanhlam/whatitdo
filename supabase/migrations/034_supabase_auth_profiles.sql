-- Re-architecture part 1: adopt Supabase Auth as the identity provider.
--
-- Supersedes the home-grown magic-link/session model (029) and the anonymous
-- `wid`/`anon_id` device identity (030–032). Identity is now `auth.users`
-- (managed by Supabase GoTrue); app profile fields live in `public.profiles`
-- (1:1 with auth.users). Every behavioral table re-keys onto `auth.users(id)`
-- and drops its anonymous half — personalization is signed-in only, so there is
-- no anon actor for RLS to reason about.
--
-- Pre-launch assumption: no production user/anon rows to preserve, so anon-only
-- rows are deleted and columns dropped rather than migrated.
--
-- Runs on real Supabase (auth.users / auth.uid() / the anon|authenticated|
-- service_role roles all exist natively) and on the test harness, which shims
-- the same objects (see lib/db/test-harness).

-- Profiles: app-owned fields keyed by the Supabase user id. Auto-created by a
-- trigger on signup so a row always exists for auth.uid().
CREATE TABLE profiles (
  id                       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name             TEXT,
  home_city_id             INT REFERENCES cities(id),
  onboarded_at             TIMESTAMPTZ,        -- null until the survey is completed or skipped
  personalization_opt_out  BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Re-key behavioral tables onto auth.users and drop the anonymous half.
--
-- Pattern per table: delete anon-only rows → drop anon_id (CASCADE also removes
-- the anon partial index and the XOR CHECK that reference it) → make user_id NOT
-- NULL → repoint/add the FK to auth.users(id) → recreate the per-user unique
-- index as a plain (non-partial) index.
-- ---------------------------------------------------------------------------

-- favorites
DELETE FROM favorites WHERE user_id IS NULL;
ALTER TABLE favorites DROP COLUMN anon_id CASCADE;
ALTER TABLE favorites ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_user_id_fkey;
ALTER TABLE favorites ADD CONSTRAINT favorites_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS favorites_user_event;
CREATE UNIQUE INDEX favorites_user_event ON favorites (user_id, event_id);

-- user_interests
DELETE FROM user_interests WHERE user_id IS NULL;
ALTER TABLE user_interests DROP COLUMN anon_id CASCADE;
ALTER TABLE user_interests ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_interests DROP CONSTRAINT IF EXISTS user_interests_user_id_fkey;
ALTER TABLE user_interests ADD CONSTRAINT user_interests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS user_interests_user;
CREATE UNIQUE INDEX user_interests_user ON user_interests (user_id, kind, value);

-- interactions (append-only; no unique index, just drop anon + repoint)
DELETE FROM interactions WHERE user_id IS NULL;
ALTER TABLE interactions DROP COLUMN anon_id CASCADE;
ALTER TABLE interactions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_user_id_fkey;
ALTER TABLE interactions ADD CONSTRAINT interactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_affinity (had no FK on user_id)
DELETE FROM user_affinity WHERE user_id IS NULL;
ALTER TABLE user_affinity DROP COLUMN anon_id CASCADE;
ALTER TABLE user_affinity ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_affinity ADD CONSTRAINT user_affinity_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS user_affinity_user;
CREATE UNIQUE INDEX user_affinity_user ON user_affinity (user_id, kind, value);

-- user_vectors (had no FK on user_id)
DELETE FROM user_vectors WHERE user_id IS NULL;
ALTER TABLE user_vectors DROP COLUMN anon_id CASCADE;
ALTER TABLE user_vectors ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_vectors ADD CONSTRAINT user_vectors_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS user_vectors_user;
CREATE UNIQUE INDEX user_vectors_user ON user_vectors (user_id);

-- rec_impressions (append-only log; user_id was nullable, no FK)
DELETE FROM rec_impressions WHERE user_id IS NULL;
ALTER TABLE rec_impressions DROP COLUMN anon_id;
ALTER TABLE rec_impressions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE rec_impressions ADD CONSTRAINT rec_impressions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- subscriptions: repoint from the (about-to-be-dropped) local users table to
-- auth.users. A digest opt-in is a separate email consent, so SET NULL not CASCADE.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Retire the home-grown auth tables (Supabase Auth owns identity + sessions now).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS users;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
