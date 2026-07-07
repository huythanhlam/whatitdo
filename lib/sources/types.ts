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
  is_free: boolean
  price_min: number | null
  price_max: number | null
}

// Context handed to every source at fetch time. `city`/`since` are the seams
// for the coming multi-city + incremental work (PRODUCT-SPEC §3); today's
// parsers ignore them, but the shape is fixed so wiring them through later
// doesn't change the interface. `logger` is a namespaced console for the run.
export type SourceContext = {
  city: string
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

