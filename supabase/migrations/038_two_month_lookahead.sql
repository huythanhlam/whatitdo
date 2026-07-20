-- Two-month lookahead for the Austin roundup crawlers (live-verified
-- 2026-07-19). 365thingsaustin.com/events publishes schema.org Event JSON-LD,
-- but its default page only reaches ~3 weeks out; the site runs "The Events
-- Calendar" (Tribe), whose list view (/events/list/) paginates forward via
-- <link rel="next" href="…/list/page/N/"> and does list Sept–Dec+ events. The
-- generic 'events-jsonld' parser reads only the first page, so point this
-- source at the list view and onto the new dedicated 'tribe-events' parser
-- (lib/sources/tribe-events.ts), which follows that pagination until it has
-- covered the ~2-month window. Same structured JSON-LD, same trust `kind`
-- ('jsonld') — only the page-walking differs.
--
-- austin.culturemap.com (culturemap parser) and austintexas.gov
-- (events-jsonld two-level branch) get their wider window purely in code
-- (day-loop length / index pagination), so no source rows change for them.
UPDATE sources
SET url = 'https://365thingsaustin.com/events/list/', parser = 'tribe-events', kind = 'jsonld'
WHERE name = 'crawl:365thingsaustin-com';
