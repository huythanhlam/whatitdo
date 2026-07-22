-- supabase/migrations/016_subscription_preferences.sql
-- Phase 5: personalized digests. Extends the category filter (migration 002)
-- with a free-only toggle and a neighborhood filter, per PRODUCT-SPEC.md
-- §4 item 8 ("category + free-only + neighborhood preferences"). Neighborhood
-- data comes from the venues geocode cache (migration 014, Phase 4), so a
-- venue's neighborhood column lives there rather than being duplicated onto
-- events.
ALTER TABLE subscriptions ADD COLUMN free_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN neighborhoods TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE venues ADD COLUMN neighborhood TEXT;
