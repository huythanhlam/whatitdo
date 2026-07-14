-- Move the generic 'crawl' (Gemini-extraction) sources still on daily cadence
-- to weekly. Unlike RSS/Bluesky/YouTube, `crawl` already skips Gemini on an
-- unchanged page via its content-hash check (lib/sources/crawler.ts), so
-- daily cadence here was mostly costing extra HTTP fetches, not Gemini spend
-- — but venue calendars (concert listings, museum hours, etc.) don't turn
-- over day to day, so weekly is still plenty fresh for this app. Leaves every
-- other mechanism (structured APIs/jsonld/ical/meetup/culturemap/partiful,
-- which are Gemini-free regardless of cadence) and the RSS/Bluesky/YouTube
-- group (which DOES spend Gemini every run) untouched — those are separate
-- decisions. `enabled = true` so the already-disabled do512/austinchronicle
-- rows are left alone.
UPDATE sources
SET cadence = 'weekly'
WHERE parser = 'crawl' AND cadence = 'daily' AND enabled = true;
