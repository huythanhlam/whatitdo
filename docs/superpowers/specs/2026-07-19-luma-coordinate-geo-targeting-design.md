# Luma coordinate geo-targeting — design

**Date:** 2026-07-19
**Status:** Approved (pending spec review)

## Problem

The `crawl:luma-com` source is supposed to pull Austin events from Luma's
public discover API. In production it pulls **DC/Maryland/Virginia** events
instead, and almost no Austin events. A one-time cleanup already deleted 124
leaked DMV rows; this spec fixes the root cause so Austin events actually land.

### Root cause (verified)

Luma's `https://api.lu.ma/discover/get-paginated-events` endpoint geo-locates
results by the **caller's IP** and **ignores `place_api_id` for geo**. Our
Vercel cron runs in the default region `iad1` (Ashburn, Virginia — the DC
metro), so the "Austin" crawl returns DMV events.

Controlled experiments from an Austin IP (`99.151.32.81`, AT&T):

| Request | Result |
| --- | --- |
| `place_api_id=<austin>` | 37 TX events |
| `place_api_id=<dc>` | 37 TX events (param ignored) |
| `place_api_id=<nyc>` | 37 TX events (param ignored) |
| `latitude=38.9047&longitude=-77.0163` (DC) | 45 DC-metro events (DC/VA/MD) |
| `latitude=40.7306&longitude=-73.9352` (NYC), paginated | 858 NYC-metro events (NY/NJ/CT) |
| `latitude=30.2672&longitude=-97.7431` (Austin), paginated | 119 events, 116 TX |

**Conclusion:** the endpoint honors explicit `latitude`/`longitude` query
params, and those **override the IP geo-bias**. The short forms `lat`/`lng`
are silently ignored — only the full names `latitude`/`longitude` work.
`place_api_id` is irrelevant once coordinates are supplied (119 events,
identical with or without it).

## Approach

Pass each city's stored coordinates (`cities.lat` / `cities.lng`) to the
paginated endpoint as `latitude`/`longitude`. This pins the geo to the city
regardless of which region the cron runs in — free, code-only, no proxy, and
it fixes Houston (`29.7604,-95.3698`) as well as Austin (`30.2672,-97.7431`).

Rejected alternative — **residential/VPS proxy with an Austin egress IP**: it
works, but adds a paid dependency, credentials, and a failure point to do what
a single query parameter now does for free. Not worth it.

## Changes

### 1. `lib/sources/luma.ts` — coordinate-driven fetch

- `fetchLumaEvents(url, source, opts)` where
  `opts: { targetState?: string; lat: number; lng: number }`.
  (`url` is retained only as the human-facing discover page stored in the DB
  row; it is no longer fetched.)
- `fetchPage(coords, cursor)` builds the URL with
  `latitude=<lat>&longitude=<lng>` (full names) plus `pagination_cursor`, and
  follows `has_more`/`next_cursor` to exhaustion under the existing `MAX_PAGES`
  cap. Verified: Austin resolves in 3 pages / 119 events.
- **Remove** the place-ID HTML round-trip and the IP-biased slug fallback:
  delete `resolvePlaceApiId`, `placeApiIdFromNextData`, and `slugFromUrl`
  (all now unused). This removes a network call and the exact fallback path
  (`slug=austin`, itself IP-biased) that made the bug worse.
- Keep the `targetState` post-filter in `eventsFromEntries` as a backstop for
  the occasional cross-metro straggler the radius still returns (the Austin
  sweep had 3 unparsed; the NYC control had NJ/CT).

### 2. `lib/sources/luma.ts` — harden `stateFromAddress`

Recognize full state names and the `Washington, DC` form in addition to the
two-letter code, so full-word-state stragglers can't slip the `targetState`
backstop. This is exactly what let two `Arlington, Virginia` events survive the
earlier cleanup.

- Add a name→code map for at least the DMV set plus common neighbors
  (`Virginia`→VA, `Maryland`→MD, `Washington, DC`/`Washington DC`→DC,
  `Texas`→TX, `New York`→NY, `New Jersey`→NJ, `Connecticut`→CT). Full 50-state
  coverage is acceptable but not required.
- Precedence: match a trailing two-letter code first (existing regex); if none,
  fall back to a full-name lookup. Return `null` when neither matches
  (unchanged contract: ambiguous ⇒ don't guess ⇒ keep the event).
- `scripts/audit-city-mismatch.ts` and `scripts/delete-city-mismatch.ts`
  already import `stateFromAddress`; they inherit the improvement for free.

### 3. Wiring — thread coordinates through the crawl context

- `lib/sources/types.ts`: extend `SourceContext.city` from
  `{ id, slug, name, state }` to also carry `lat: number | null` and
  `lng: number | null`.
- `app/api/ingest/route.ts` (`contextFor`): include `lat: city.lat` and
  `lng: city.lng` (the full `City` row already has them).
- `lib/sources/registry.ts`: update the `luma` entry to pass coordinates and
  state, e.g.
  `fetchLumaEvents(url!, name, { targetState: ctx.city.state, lat: ctx.city.lat, lng: ctx.city.lng })`.
- If a city has null coordinates (should not happen for seeded cities, both of
  which have coords), the luma source logs and returns `[]` rather than
  crawling with no geo — a silent IP-based crawl is exactly the failure we are
  removing, so we fail closed.

## Testing

Unit (Vitest, pure functions — no network), in `lib/sources/luma.test.ts`:

- **`stateFromAddress` hardening:** full names resolve (`"..., Virginia"`→VA,
  `"Laurel, Maryland"`→MD, `"Washington, DC"`→DC); two-letter codes still
  resolve; ambiguous/absent still returns `null`; two-letter code takes
  precedence when both could match.
- **URL construction:** a small extracted pure helper builds the
  `get-paginated-events` URL with `latitude`/`longitude` (full names) and the
  cursor — assert the query string, no fetch.
- **Remove** the `slugFromUrl` and `placeApiIdFromNextData` describe blocks
  (functions deleted). Keep and reuse the `eventsFromEntries` /
  `targetState` blocks unchanged.

Live verification:

- From this (Austin) machine the crawl always returns Austin events regardless
  of the fix, so local runs cannot prove the production behavior. The
  controlled DC-coords-from-Austin-IP and NYC-coords-from-Austin-IP experiments
  above already prove the parameter overrides IP.
- After deploy, confirm in production: trigger `/api/ingest?city=austin`, then
  re-run `scripts/audit-city-mismatch.ts austin` and confirm new
  `crawl:luma-com` rows are TX (0 state mismatches), and that the source run's
  `events_found` jumps from ~2 to ~100+.

## Out of scope

- The residential/VPS proxy path (rejected above).
- Re-adding the deleted DMV rows (already cleaned up).
- Changing the Vercel cron region (does not help; no Austin region exists, and
  coordinates make region irrelevant).
