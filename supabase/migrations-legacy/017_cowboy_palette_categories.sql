-- Category swatches (used for event badges/map pins/calendar dots, read from
-- the DB rather than lib/categories.ts at render time) were still seeded with
-- the old violet-brand palette from migration 001. Update them to match the
-- "modern cowboy" redesign (see lib/categories.ts for the same values).
UPDATE categories SET color = '#C1502E' WHERE slug = 'music';
UPDATE categories SET color = '#E8823C' WHERE slug = 'comedy';
UPDATE categories SET color = '#7C8F63' WHERE slug = 'food-drink';
UPDATE categories SET color = '#2C5F9E' WHERE slug = 'arts';
UPDATE categories SET color = '#9C3B2E' WHERE slug = 'sports';
UPDATE categories SET color = '#2A9D96' WHERE slug = 'family';
UPDATE categories SET color = '#8A3B57' WHERE slug = 'festivals';
UPDATE categories SET color = '#573F2C' WHERE slug = 'film';
UPDATE categories SET color = '#4F5B41' WHERE slug = 'outdoors';
UPDATE categories SET color = '#1C3D66' WHERE slug = 'networking';
UPDATE categories SET color = '#A98866' WHERE slug = 'other';
