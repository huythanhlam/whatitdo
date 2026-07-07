import { normalizeTitle, normalizeVenue } from './normalize'
import type { RawEvent, SourceKind } from './sources/types'

// Source-trust ranking for merge tiebreaks (PRODUCT-SPEC §2.2.3): api > ical >
// jsonld > rss/crawl. Keyed by source *name*; kinds mirror the registry. Kept as a
// small static map so the pure merge stays dependency-light and testable. Phase
// 2B, which makes sources DB-driven, can replace this with a kind lookup.
const KIND_BY_SOURCE: Record<string, SourceKind> = {
  ticketmaster: 'api',
  seatgeek: 'api',
  youtube: 'api',
  ical: 'ical',
  eventbrite: 'jsonld',
  newspapers: 'rss',
  social: 'crawl',
  crawl: 'crawl',
  seed: 'seed',
}

// rss sits at the crawl tier: newspaper RSS is Gemini-extracted, not structured.
const TRUST_BY_KIND: Record<string, number> = { api: 4, ical: 3, jsonld: 2, rss: 1, crawl: 1, seed: 1 }

export function sourceTrust(source: string): number {
  const kind = KIND_BY_SOURCE[source]
  return kind ? TRUST_BY_KIND[kind] ?? 0 : 0
}

// A blocked candidate, scored in SQL: `sim` = pg_trgm similarity(title_norm),
// `venueAgree` = both venues non-null and equal.
export type Candidate = { id: string; sim: number; venueAgree: boolean }

// The match threshold policy (PRODUCT-SPEC §2.2.2): >= 0.55 with venue agreement,
// or >= 0.85 without. Candidates may arrive in any order, so we scan all of them
// and keep the highest-sim passing candidate rather than the first one found.
export function chooseMatch(candidates: Candidate[]): string | null {
  let best: Candidate | null = null
  for (const c of candidates) {
    const passes = (c.sim >= 0.55 && c.venueAgree) || c.sim >= 0.85
    if (passes && (!best || c.sim > best.sim)) best = c
  }
  return best ? best.id : null
}

// The canonical event's mergeable fields (a row already in `events`).
export type ExistingEvent = {
  source: string
  source_id: string | null
  title: string
  venue_norm: string | null
  description: string | null
  image_url: string | null
  venue_name: string | null
  venue_address: string | null
  end_time: string | null
  ticket_url: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
}

// A whitelisted patch of columns to UPDATE on the canonical event. All keys are
// column names; `updateEventFields` only writes these.
export type FieldPatch = Partial<{
  title: string
  title_norm: string
  source: string
  source_id: string | null
  description: string | null
  image_url: string | null
  venue_name: string | null
  venue_norm: string | null
  venue_address: string | null
  end_time: string | null
  ticket_url: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
}>

// Field-wise "richest wins" (PRODUCT-SPEC §2.2.3), tie-broken by source trust.
// Returns null when the incoming record adds nothing.
export function mergeFields(existing: ExistingEvent, incoming: RawEvent): FieldPatch | null {
  const patch: FieldPatch = {}

  // Longest description wins.
  if ((incoming.description?.length ?? 0) > (existing.description?.length ?? 0)) {
    patch.description = incoming.description
  }
  // Any image over none.
  if (!existing.image_url && incoming.image_url) patch.image_url = incoming.image_url
  // Fill missing nullable fields.
  if (!existing.venue_name && incoming.venue_name) patch.venue_name = incoming.venue_name
  // Keep venue_norm in lockstep with venue_name so the dedup block index stays fresh.
  if (patch.venue_name) patch.venue_norm = normalizeVenue(patch.venue_name)
  if (!existing.venue_address && incoming.venue_address) patch.venue_address = incoming.venue_address
  if (!existing.end_time && incoming.end_time) patch.end_time = incoming.end_time
  // Widen the price range.
  if (incoming.price_min != null && (existing.price_min == null || incoming.price_min < existing.price_min)) {
    patch.price_min = incoming.price_min
  }
  if (incoming.price_max != null && (existing.price_max == null || incoming.price_max > existing.price_max)) {
    patch.price_max = incoming.price_max
  }
  // Free is sticky: once any source says free, stay free.
  if (incoming.is_free && !existing.is_free) patch.is_free = true

  // A more-trusted source owns the canonical title, ticket link, and primary source.
  if (sourceTrust(incoming.source) > sourceTrust(existing.source)) {
    patch.source = incoming.source
    patch.source_id = incoming.source_id
    if (incoming.ticket_url) patch.ticket_url = incoming.ticket_url
    if (incoming.title) {
      patch.title = incoming.title
      patch.title_norm = normalizeTitle(incoming.title, incoming.venue_name)
    }
  }

  return Object.keys(patch).length > 0 ? patch : null
}
