-- Newspaper/Reddit/Bluesky/YouTube all route free text through Gemini to
-- *guess* whether a general-purpose article or social post is secretly a
-- specific, upcoming, dated event (see lib/sources/social.ts's own framing:
-- "reject... general news, opinion, multi-event roundups, or undated").
-- Unlike every other source category, none of them are structured feeds
-- (Ticketmaster/SeatGeek/Eventbrite/JSON-LD/Meetup/Luma/Partiful/Simpleview)
-- or hash-gated venue pages (crawl) — they're the noisiest extraction surface
-- in the pipeline, they duplicate coverage the ~50 dedicated venue/roundup
-- crawlers already get more precisely, and they run daily with no
-- dedup-before-call gate, burning ~34 Gemini requests/day (~17% of the
-- default 200/day budget, see lib/gemini.ts) re-extracting largely the same
-- content each day. Judged not worth it; disabled rather than deleted so
-- historical source_runs/event_sources provenance keeps its FK, same
-- convention as migration 019.
UPDATE sources
SET enabled = false,
    notes = trim(both '; ' from concat_ws('; ', notes, 'disabled 2026-07-13: low-precision free-text extraction, overlaps dedicated venue/roundup sources, not worth its Gemini budget share'))
WHERE name IN (
  'newspaper:kut',
  'newspaper:austin-monitor',
  'newspaper:daily-texan',
  'newspaper:towers',
  'newspaper:kvue',
  'newspaper:eater-austin',
  'newspaper:kxan',
  'newspaper:community-impact',
  'newspaper:fox7-austin',
  'social:reddit-austinevents',
  'social:reddit-austin',
  'social:bluesky',
  'youtube'
);
