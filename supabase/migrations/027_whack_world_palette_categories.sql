-- Category swatches (used for event badges/map pins/calendar dots, read from
-- the DB rather than lib/categories.ts at render time) were seeded with the
-- "modern cowboy" terracotta/turquoise palette from migration 017. Update them
-- to match the new coral/amber/tangerine/slate palette (see lib/categories.ts
-- for the same values).
UPDATE categories SET color = '#F17A7E' WHERE slug = 'music';
UPDATE categories SET color = '#FFC94B' WHERE slug = 'comedy';
UPDATE categories SET color = '#F9A66C' WHERE slug = 'food-drink';
UPDATE categories SET color = '#4A6163' WHERE slug = 'arts';
UPDATE categories SET color = '#B8454A' WHERE slug = 'sports';
UPDATE categories SET color = '#7C9092' WHERE slug = 'family';
UPDATE categories SET color = '#8C4A5E' WHERE slug = 'festivals';
UPDATE categories SET color = '#2A3B3C' WHERE slug = 'film';
UPDATE categories SET color = '#7C9A4F' WHERE slug = 'outdoors';
UPDATE categories SET color = '#3E5A72' WHERE slug = 'networking';
UPDATE categories SET color = '#A98F66' WHERE slug = 'other';
