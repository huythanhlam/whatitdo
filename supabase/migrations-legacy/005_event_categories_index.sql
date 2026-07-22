-- Index the FK side of the events <-> categories join. Without it, filtering
-- events by category (the sidebar filters) forces a sequential scan of
-- event_categories on every request. The events(id) side is already covered by
-- the primary key; this covers the category_id lookups.
CREATE INDEX IF NOT EXISTS event_categories_category_id ON event_categories(category_id);
