-- Admin permission on profiles.
--
-- Replaces the shared-CRON_SECRET admin gate with a real per-user permission:
-- the admin page/API now require a logged-in user whose profile has is_admin.
-- CRON_SECRET stays only for the actual cron routes (ingest/import/etc.).
--
-- ADMINS ARE SEEDED BY EMAIL. To add/remove an admin, add a new migration that
-- edits BOTH lists below (the seed UPDATE and the handle_new_user trigger) so
-- they never drift — that is the whole source of truth for who is an admin.

ALTER TABLE profiles ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

-- Prevent privilege self-escalation. Migration 035 granted table-wide
-- INSERT/UPDATE on profiles to `authenticated`, and the "own profile" policy is
-- FOR ALL WITH CHECK (auth.uid() = id) — so without this a user could set their
-- own is_admin = true via PostgREST. RLS WITH CHECK cannot express "this column
-- must not change", so restrict the privilege to specific columns instead
-- (column privileges are ANDed with the RLS policy). is_admin is deliberately
-- excluded from both grants, so only the service role / SQL owner can write it.
-- INSERT keeps `id` so markOnboarded's upsert({ id }) still works.
REVOKE UPDATE, INSERT ON profiles FROM authenticated;
GRANT UPDATE (display_name, home_city_id, onboarded_at,
              personalization_opt_out, magic_link_enabled)
  ON profiles TO authenticated;
GRANT INSERT (id, display_name, home_city_id, onboarded_at,
              personalization_opt_out, magic_link_enabled)
  ON profiles TO authenticated;

-- Seed admins whose account already exists (case-insensitive, matching 037).
UPDATE profiles SET is_admin = true
WHERE id IN (
  SELECT id FROM auth.users
  WHERE lower(email) IN ('huythanhlam1@gmail.com')
);

-- Promote admin emails on signup too, so it works regardless of whether the
-- account is created before or after this migration (e.g. fresh local dev).
-- Keep this email list identical to the seed UPDATE above.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, is_admin)
  VALUES (NEW.id, lower(NEW.email) IN ('huythanhlam1@gmail.com'))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
