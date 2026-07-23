-- Phase 4: map view needs a default center per city. `cities.lat`/`lng`
-- (migration 007) were never populated for either seeded city — backfill both
-- centroids (approximate downtown coordinates) so the map has a sane default
-- center instead of falling back to a hardcoded value for every city.
UPDATE cities SET lat = 30.2672, lng = -97.7431 WHERE slug = 'austin';
UPDATE cities SET lat = 29.7604, lng = -95.3698 WHERE slug = 'houston';
