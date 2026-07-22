-- crawl:luma-ics-austin (added in migration 028) turns out to be fully
-- redundant with crawl:luma-com (the JSON-API crawler, migration 024): both
-- read the SAME Luma "Austin discover place" (discplace-0tPy8KGz3xMycnt), just
-- via different endpoints. Migration 028 assumed the ~28 .ics VEVENTs only
-- *partially* overlapped the JSON feed's ~120 events ("extra coverage, not a
-- duplicate"); live re-verification shows that is wrong — every current .ics
-- event is also in the JSON feed, i.e. the ICS set is a strict subset.
--
-- The ICS path is also the strictly worse of the two for event *details*: its
-- VEVENTs carry no cover image, and its LOCATION field (mapped into both
-- venue_name and venue_address by lib/sources/ical.ts) is coarse or absent,
-- whereas the JSON crawler yields a structured geo_address_info plus a
-- cover_url/social_image_url (see lib/sources/luma.ts). Where dedup merges the
-- two, ical outranks jsonld in lib/dedup.ts's trust order, so the poorer ICS
-- venue/image can even win over the better JSON one.
--
-- Disable (don't delete) so historical source_runs/event_sources provenance
-- keeps its FK, same convention as migrations 019 and 025. The generic `ical`
-- parser stays registered — other sources (austin-gov, houston-gov) still use it.
UPDATE sources
SET enabled = false,
    notes = trim(both '; ' from concat_ws('; ', notes, 'disabled 2026-07-22: redundant with crawl:luma-com (same Luma Austin discover place); ICS events are a strict subset and carry worse venue/image detail'))
WHERE name = 'crawl:luma-ics-austin';
