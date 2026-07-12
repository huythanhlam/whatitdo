export type RawEvent = {
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  image_url: string | null
  ticket_url: string | null
  source: string
  source_id: string
  // The authoritative kind of the `sources` row this event came from (its
  // `kind` column), stamped on by lib/sources/registry.ts's PARSERS dispatch
  // at fetch time. Optional/nullable because plenty of RawEvents never flow
  // through the registry (seed data, public submissions, ad-hoc /api/import
  // crawls, test fixtures) — sourceTrust() falls back to its static
  // name-based map when this is absent, so omitting it is always safe.
  source_kind?: SourceKind | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
}

// `city` carries enough of the `cities` row for structured APIs (Ticketmaster,
// SeatGeek) to query the right geography — previously a bare 'austin' string
// that nothing actually read.
export type SourceContext = {
  city: { id: number; slug: string; name: string; state: string }
  since: Date
  logger: Pick<Console, 'log' | 'warn' | 'error'>
}

// The kind of pipeline a source runs through — used for grouping in the health
// view and (later) cost accounting: 'crawl' sources spend Gemini tokens, the
// structured API/ical sources don't.
export type SourceKind = 'api' | 'ical' | 'rss' | 'jsonld' | 'crawl' | 'seed'

// A configured source instance (one row of the `sources` table). The code holds
// parser MECHANISMS; the database holds these INSTANCES. `name` is the exact
// RawEvent.source string the row's parser emits, so provenance links back by name.
export type SourceRow = {
  id: number
  city_id: number
  name: string
  kind: SourceKind
  url: string | null
  parser: string
  cadence: 'daily' | 'weekly'
  enabled: boolean
  last_success: string | null
  content_hash: string | null
  notes: string | null
  // Per-source override for 'crawl-paginated''s page count, for sources whose
  // full listing is far bigger than 2 pages (e.g. a calendar with hundreds of
  // pages) where 2 pages would silently be a small, unlabeled sample rather
  // than the "complete coverage" 2 pages gives Chronicle's Staff Pick view.
  // Null means the parser's own built-in default; ignored by every other parser.
  max_pages: number | null
}

// A parser MECHANISM. Instances live in the DB (`SourceRow`); the code registry
// maps `SourceRow.parser` → one of these. `available()` replaces the old
// per-source enabled() API-key check: enabled(DB) AND available(code) must both
// hold or the run is recorded as `skipped`. `crawl` returns a skip flag so the
// orchestrator can distinguish "unchanged, didn't spend Gemini" from "found
// nothing".
export interface SourceParser {
  available(): boolean
  fetch(source: SourceRow, ctx: SourceContext): Promise<{ events: RawEvent[]; skipped: boolean }>
}

