-- austin.culturemap.com/events/ was live-verified (curl, no browser) to be
-- static server-rendered HTML: each event <article> embeds its own
-- <script type="application/json" id="post-context-...">, whose post.tags
-- array gives an exact occurrence time (occurrenceYYYYMMDDHHmm) alongside
-- the plain YYYYMMDD date tags the page's own day filter (?tags=YYYYMMDD)
-- uses. That's structured enough for a dedicated parser (lib/sources/
-- culturemap.ts) that walks the next 14 days of ?tags= pages — no Gemini,
-- no BROWSER_FETCH_URL — replacing the generic single-day 'crawl' parser
-- this source launched with in 019_source_refresh.sql. `kind` moves from
-- 'crawl' (Gemini-extracted, trust tier 1) to 'jsonld' (structured/exact,
-- trust tier 2) to match the other no-Gemini structured sources.
UPDATE sources
SET parser = 'culturemap', kind = 'jsonld'
WHERE name = 'crawl:austin-culturemap-com';
