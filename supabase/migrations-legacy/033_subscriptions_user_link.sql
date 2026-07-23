-- Personalized recommendations, part 5: converge digest identity with accounts.
--
-- `subscriptions.user_id` (migration 002) still references the Supabase-native
-- auth.users — a table the app never populates. Now that magic-link accounts ship
-- (029 users), digest identity and account identity should be the same person, so
-- this repoints the FK at our own users(id). The auth routes then link a
-- subscription to its owner (set user_id) when a verified email matches.
--
-- ON DELETE SET NULL, not CASCADE: a digest subscription is a separate consent
-- with its own unsubscribe token, so deleting an account unlinks the subscription
-- rather than silently killing an email opt-in the person may still want.
--
-- Runs verbatim on both drivers: the inline FK in 002 is auto-named
-- `subscriptions_user_id_fkey` on Postgres and PGlite alike, and DROP ... IF
-- EXISTS keeps this safe if it was ever named differently. PGlite shims auth.users
-- (see the pglite preamble), so the old constraint exists there too.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id) WHERE user_id IS NOT NULL;
