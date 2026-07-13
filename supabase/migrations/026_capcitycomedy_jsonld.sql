-- capcitycomedy.com publishes its full schedule (285 upcoming shows,
-- live-verified 2026-07-13) as structured JSON-LD right on the homepage —
-- each Event carries its own real per-show image (a comedian headshot from
-- their ticketing vendor, seatengine.com) and its own ticket URL. It's just
-- nested under a non-standard Place.Events key rather than the usual
-- @graph/itemListElement wrapper, which lib/sources/jsonld-events.ts's
-- collector now walks generically (see that file). Moving off the generic
-- 'crawl' (Gemini-text) parser gets exact per-event images and ticket links
-- for free, instead of Gemini text-extraction with no image data at all.
UPDATE sources
SET kind = 'jsonld', parser = 'events-jsonld'
WHERE name = 'crawl:capcitycomedy-com';
