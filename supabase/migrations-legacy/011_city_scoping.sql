-- Phase 3: complete the city_id FK sweep started in migration 007/008.
-- subscriptions gets a real per-city identity (a user may want independent
-- Austin + Houston digests), so the uniqueness constraint moves from
-- UNIQUE(email) to UNIQUE(email, city_id). featured_listings' city_id is
-- denormalized from its event's city_id so city-scoped admin/reporting
-- queries never need a join.

ALTER TABLE subscriptions ADD COLUMN city_id INT REFERENCES cities(id);
UPDATE subscriptions SET city_id = 1 WHERE city_id IS NULL;
ALTER TABLE subscriptions ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN city_id SET DEFAULT 1;

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_email_key;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_email_city_key UNIQUE (email, city_id);

ALTER TABLE featured_listings ADD COLUMN city_id INT REFERENCES cities(id);
UPDATE featured_listings f SET city_id = e.city_id
  FROM events e WHERE f.event_id = e.id AND f.city_id IS NULL;
UPDATE featured_listings SET city_id = 1 WHERE city_id IS NULL; -- orphaned rows, default Austin
ALTER TABLE featured_listings ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE featured_listings ALTER COLUMN city_id SET DEFAULT 1;

CREATE INDEX subscriptions_city ON subscriptions (city_id, frequency);
CREATE INDEX featured_listings_city ON featured_listings (city_id);
