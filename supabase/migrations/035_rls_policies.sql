-- Re-architecture part 2: real per-user RLS + a gated catalog.
--
-- Until now every RLS policy was `auth.role() = 'service_role'` and the app
-- connected as a superuser that bypassed RLS, so the policies were cosmetic. Now
-- user-facing access runs through PostgREST under the end user's JWT (the
-- `authenticated` role with auth.uid() set), so these policies are the real gate.
-- The backend still uses an elevated connection (service_role / the pg service
-- pool), which bypasses RLS by design — so service jobs need no explicit policy.
--
-- Two shapes:
--   * private user tables  → FOR ALL TO authenticated, own rows only (auth.uid()=user_id)
--   * the catalog          → readable only by `authenticated` (anon gets nothing
--                            directly; the teaser RPC in 036 is its only door)

-- ---------------------------------------------------------------------------
-- Private, per-user tables: a user sees and writes only their own rows.
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
-- Shared aggregates: any signed-in user may READ (ranking needs them); writes
-- happen through the service path / SECURITY DEFINER RPCs, never directly.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role manages event_engagement" ON event_engagement;
CREATE POLICY "read engagement" ON event_engagement
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Service role manages model_versions" ON model_versions;
CREATE POLICY "read model" ON model_versions
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Catalog: authenticated-only. Drop the blanket public-read policies (which
-- applied to anon too) and re-grant read to `authenticated` only. Anon reaches
-- events solely through public_suggested_events() (036). cities + categories
-- stay public so the app shell and the teaser can render.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public read events" ON events;
DROP POLICY IF EXISTS "Service role write events" ON events;
CREATE POLICY "auth read events" ON events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Public read event_categories" ON event_categories;
DROP POLICY IF EXISTS "Service role write event_categories" ON event_categories;
CREATE POLICY "auth read event_categories" ON event_categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Public read event_sources" ON event_sources;
DROP POLICY IF EXISTS "Service role write event_sources" ON event_sources;
CREATE POLICY "auth read event_sources" ON event_sources FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Public read venues" ON venues;
DROP POLICY IF EXISTS "Service role write venues" ON venues;
CREATE POLICY "auth read venues" ON venues FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Public read venue_images" ON venue_images;
DROP POLICY IF EXISTS "Service role write venue_images" ON venue_images;
CREATE POLICY "auth read venue_images" ON venue_images FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Public read featured" ON featured_listings;
DROP POLICY IF EXISTS "Service role write featured" ON featured_listings;
CREATE POLICY "auth read featured" ON featured_listings FOR SELECT TO authenticated USING (true);

-- Ingestion config isn't user-facing; make it service-only (drop public read).
DROP POLICY IF EXISTS "Public read sources" ON sources;
DROP POLICY IF EXISTS "Service role write sources" ON sources;

-- ---------------------------------------------------------------------------
-- Grants. RLS is ANDed with table privileges, so the roles need the right
-- base grants for the policies above to mean anything.
-- ---------------------------------------------------------------------------

-- authenticated needs DML (migration 004 only granted SELECT) so a signed-in
-- user can write their own rows under the per-user policies.
GRANT INSERT, UPDATE, DELETE ON
  profiles, favorites, user_interests, interactions, user_affinity, user_vectors, rec_impressions, subscriptions
  TO authenticated;
-- BIGSERIAL tables (interactions, rec_impressions) need sequence USAGE to insert.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- anon reads nothing directly except the app shell (cities, categories) and the
-- teaser RPC (036). Revoke the blanket SELECT migration 004 gave anon, and stop
-- future tables from inheriting it, so the catalog is closed by grant AND policy.
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;
GRANT SELECT ON cities, categories TO anon;
