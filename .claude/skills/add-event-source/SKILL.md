---
name: add-event-source
description: Add a new event source to what-it-do, or fix a broken/stale one, following the repo's adapter + fixture-test pattern. Use whenever work touches lib/sources/ — including when /api/admin/health reports a source as stale.
---

# Adding or fixing an event source

Every source follows one contract and one registration point. Do not invent a
parallel pattern.

## The pattern

1. **Adapter**: implement `fetch(): Promise<RawEvent[]>` in a new file under
   `lib/sources/` (see `lib/sources/types.ts` for `RawEvent`, `SourceContext`,
   `SourceKind`, and the `SourceAdapter` contract). Model it on the closest
   existing source: `ticketmaster.ts`/`seatgeek.ts` (structured API),
   `eventbrite.ts` (JSON-LD scrape), `ical.ts`, `rss.ts`+`newspapers.ts`
   (feeds), `crawler.ts` (Gemini-extracted pages).
2. **Register**: add ONE line to `SOURCES` in `lib/sources/registry.ts`.
   `enabled()` must honestly answer "can this produce anything right now?" —
   gate on the required env keys (`has(process.env.X)`), never return `[]`
   silently from a missing key. Pick the right `kind` ('api' | 'ical' | 'rss'
   | 'jsonld' | 'crawl' | 'seed'); 'crawl' kinds spend Gemini tokens.
3. **Fixture**: save a REAL captured payload (fetched once, by hand) in
   `lib/sources/__fixtures__/` — see `rss-newspaper.xml`,
   `youtube-search.json`, `crawl-page.html`. Never hand-write a fixture from
   memory of what the API "should" return.
4. **Test**: add a describe-block to `lib/sources/parsers.test.ts` driving the
   pure parsing function against the fixture. Required assertions, matching
   the existing blocks:
   - parses the expected items and skips malformed ones;
   - **never fabricates a date** — dates are real ISO strings from the payload
     or `null`, and publication dates are not passed off as event start times;
   - URLs/images are absolute.
   Keep parsing pure (payload → items) and separate from fetching, so it is
   testable without network.
5. **Respect the shared plumbing**: all Gemini calls go through `geminiJson` /
   `mapPool` in `lib/gemini.ts` (budget, RPM limit, per-source metering) —
   never instantiate a second client. Persistence goes through
   `persistEvents` in `lib/persist.ts`; its validation gate rejects
   undateable events and events >18 months out, so don't pre-filter what it
   already enforces. Remote fetches of user-supplied URLs must use the
   SSRF-guarded fetch in `lib/ssrf.ts`.
6. **Document**: if the source needs an env key, add a commented section to
   `.env.example` in the existing style (what it does, where to get a free
   key, what happens without it).

## Fixing a stale source (the health-loop playbook)

`GET /api/admin/health` marks a source stale after 3 consecutive bad runs
(errored or zero events) when it previously produced events — i.e. the
upstream site/API changed shape.

1. Read the `error` and counts in the health payload's `recent` runs.
2. Re-capture a fresh fixture from the live upstream and diff it against the
   old one — the diff usually IS the bug.
3. Fix the parser, update the fixture + assertions in `parsers.test.ts`.
4. Verify (below). Do not "fix" a source by loosening the no-fabricated-dates
   rules — rejected events are the validation gate working.

## Verification (definition of done)

Run the `verify-app` skill. For source work specifically that means:

- `npm test` green, including the new/updated `parsers.test.ts` block;
- one zero-credential ingest run (`npm run dev`, then
  `curl -X POST http://localhost:3000/api/ingest`);
- `curl http://localhost:3000/api/admin/health` shows the source's run as
  `ok` with `events_upserted > 0`, or `skipped` when its key is absent —
  never an unexplained `error` or a zero-upsert `ok`.
