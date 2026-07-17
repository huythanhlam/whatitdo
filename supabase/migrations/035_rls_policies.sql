-- Re-architecture part 2: real per-user RLS on user-private + ML data only.
--
-- Until now every RLS policy was `auth.role() = 'service_role'` and the app
-- connected as a superuser that bypassed RLS, so the policies were cosmetic. Now
-- user-facing access to *personal* data runs through PostgREST under the end
-- user's JWT (the `authenticated` role with auth.uid() set), so these policies
-- are the real gate. The backend still uses an elevated connection (service_role
-- / the pg service pool), which bypasses RLS by design.
--
-- Scope (deliberate): RLS protects only user-private and ML/personalization
-- tables. Event metadata — the catalog (events, venues, categories, …) and the
-- shared per-event aggregates (event_engagement, model_versions) — is NOT
-- user-private and stays publicly readable exactly as before; it gets no per-user
-- RLS. Anonymous visitors keep the full public catalog; only personalization
-- requires an account.

-- ---------------------------------------------------------------------------
-- Private, per-user tables: a user sees and writes only their own rows.
-- (profiles is the account; the rest are favorites + the ML signal/feature stores.)
-- ---------------------------------------------------------------------------
CREATE POLICY "own profile" ON profiles
  FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Service role manages favorites" ON favorites;
CREATE POLICY "own favorites" ON favorites
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages user_interests" ON user_interests;
CREATE POLICY "own interests" ON user_interests
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages interactions" ON interactions;
CREATE POLICY "own interactions" ON interactions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages user_affinity" ON user_affinity;
CREATE POLICY "own affinity" ON user_affinity
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages user_vectors" ON user_vectors;
CREATE POLICY "own vectors" ON user_vectors
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages rec_impressions" ON rec_impressions;
CREATE POLICY "own impressions" ON rec_impressions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- subscriptions become account-owned; anon subscribe still works via the service path.
DROP POLICY IF EXISTS "Service role manages subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users read own subscriptions" ON subscriptions;
CREATE POLICY "own subscriptions" ON subscriptions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Shared per-event aggregates: event metadata, not user data. Publicly readable
-- (ranking + trending read them) — no per-user RLS. Writes still happen only
-- through the service path / SECURITY DEFINER RPCs (036), never a direct user
-- write, so one user can't skew another's counts.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role manages event_engagement" ON event_engagement;
CREATE POLICY "read engagement" ON event_engagement FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages model_versions" ON model_versions;
CREATE POLICY "read model" ON model_versions FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- Grants. RLS is ANDed with table privileges, so `authenticated` needs DML on
-- the private tables (migration 004 only granted SELECT) to write its own rows.
-- The catalog's existing public-read grants/policies are untouched.
-- ---------------------------------------------------------------------------
GRANT INSERT, UPDATE, DELETE ON
  profiles, favorites, user_interests, interactions, user_affinity, user_vectors, rec_impressions, subscriptions
  TO authenticated;
-- BIGSERIAL tables (interactions, rec_impressions) need sequence USAGE to insert.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Close the private tables to anon by grant as well as policy (migration 004
-- blanket-granted SELECT to anon). The public catalog keeps its anon grant.
REVOKE SELECT ON
  profiles, favorites, user_interests, interactions, user_affinity, user_vectors, rec_impressions, subscriptions
  FROM anon;
