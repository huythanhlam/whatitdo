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

// The single contract every source implements. `enabled()` replaces today's
// silent []-return when an API key is missing: a disabled source is recorded as
// `skipped` in source_runs rather than looking like an empty (dead) source.
export interface SourceAdapter {
  name: string
  kind: SourceKind
  enabled(): boolean
  fetch(ctx: SourceContext): Promise<RawEvent[]>
}

