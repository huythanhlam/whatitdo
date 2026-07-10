import { tagEvents } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import {
  getCategoryIdBySlug, setEventCategories,
  findEventBySource, findDedupCandidates, insertEvent,
  getEventRow, updateEventFields, recordProvenance,
  getCityById, type City,
} from '@/lib/db'
import { normalizeTitle, normalizeVenue } from '@/lib/normalize'
import { chooseMatch, mergeFields } from '@/lib/dedup'
import { ensureVenueGeocoded } from '@/lib/geocode'
import type { RawEvent } from '@/lib/sources/types'

// The single validation gate. A fabricated or nonsensical date is worse than no
// event — it actively misleads users — so an event is rejected when its
// start_time is missing/unparseable, its title is empty, or it starts more than
// 18 months out. Every source flows through persistEvents, so this bans
// fabricated dates repo-wide rather than per-scraper.
const MAX_FUTURE_MS = 18 * 30 * 24 * 60 * 60 * 1000 // ~18 months

export function isValidEvent(raw: RawEvent): boolean {
  if (!raw.title || raw.title.trim().length === 0) return false
  if (!raw.start_time) return false
  const t = new Date(raw.start_time).getTime()
  if (!Number.isFinite(t)) return false
  if (t > Date.now() + MAX_FUTURE_MS) return false
  return true
}

export type EventStatus = 'approved' | 'pending'

// Shared persistence pipeline used by the scheduled ingest, the on-demand
// importer, and public submissions. `cityId` defaults to Austin (1) so
// existing tests/call sites that don't pass it keep working; `status`
// defaults to 'approved' (pipeline-trusted sources) — public submissions pass
// 'pending' explicitly (see persistOne's merge-skip rule below).
export async function persistEvents(
  input: RawEvent[],
  opts: { cityId?: number; status?: EventStatus } = {}
): Promise<{ inserted: number; skipped: number; rejected: number; total: number }> {
  const cityId = opts.cityId ?? 1
  const status = opts.status ?? 'approved'

  const total = input.length
  if (total === 0) return { inserted: 0, skipped: 0, rejected: 0, total: 0 }

  const events = input.filter(isValidEvent)
  const rejected = total - events.length
  if (events.length === 0) return { inserted: 0, skipped: 0, rejected, total }

  const categoryIdBySlug = await getCategoryIdBySlug()
  const slugs = await tagEvents(events.map(e => ({ title: e.title, description: e.description })))

  events.forEach((raw, i) => {
    if (!raw.image_url) raw.image_url = imageForCategories(slugs[i])
  })

  // Fetched once per batch (not per event) for ensureVenueGeocoded's city-name
  // fallback query — cityId is constant across the whole call.
  const city = await getCityById(cityId)

  // Venues repeat heavily within a batch (many events at the same handful of
  // venues); this Set skips the geocode-cache lookup entirely for a venueNorm
  // already checked earlier in THIS run, instead of re-querying the venues
  // table once per event.
  const checkedVenues = new Set<string>()

  let inserted = 0
  let skipped = 0

  // Dedup mutates shared candidate state (an event inserted by one item can match
  // the next), so persist sequentially rather than with a concurrency pool.
  // Ingest already runs sources concurrently; within a source, order matters.
  for (let i = 0; i < events.length; i++) {
    try {
      const eventId = await persistOne(events[i], cityId, status, city, checkedVenues)
      const categoryIds = slugs[i].map(s => categoryIdBySlug[s]).filter(Boolean)
      await setEventCategories(eventId, categoryIds)
      inserted++
    } catch {
      skipped++
    }
  }

  return { inserted, skipped, rejected, total }
}

// Resolve one raw event to a canonical event id, creating, matching, or merging
// as needed, and always recording provenance. Returns the canonical event id.
async function persistOne(
  raw: RawEvent, cityId: number, status: EventStatus, city: City | null, checkedVenues: Set<string>
): Promise<string> {
  const titleNorm = normalizeTitle(raw.title, raw.venue_name)
  const venueNorm = normalizeVenue(raw.venue_name)

  // Geocode this venue if not already cached — unconditional (not just on the
  // new-insert branch below) so venues that only ever get merged into an
  // existing canonical event still get a pin on the map. Never throws (see
  // ensureVenueGeocoded's own try/catch), so no wrapping catch needed here.
  // checkedVenues skips the DB cache-lookup for a venueNorm already checked
  // earlier in this same persistEvents call.
  if (venueNorm && city && !checkedVenues.has(venueNorm)) {
    checkedVenues.add(venueNorm)
    await ensureVenueGeocoded({ cityId, venueNorm, venueName: raw.venue_name!, venueAddress: raw.venue_address, city })
  }

  // 1. Idempotency: already seen this exact (source, external_id)?
  let eventId = await findEventBySource(raw.source, raw.source_id)

  if (eventId) {
    // Same submission/source re-ingested — always safe to merge (same author).
    const existing = await getEventRow(eventId)
    if (existing) {
      const patch = mergeFields(existing, raw)
      if (patch) await updateEventFields(eventId, patch)
    }
  } else {
    // 2. Block + score against existing canonical events.
    const candidates = await findDedupCandidates({ cityId, startTime: raw.start_time, titleNorm, venueNorm })
    const matchId = chooseMatch(candidates)

    if (matchId) {
      // 3a. Matched a different source's event — merge into it.
      eventId = matchId
      // An unmoderated ('pending') submission that cross-source-matches an
      // existing canonical event must NOT overwrite its fields — only
      // pipeline-trusted sources merge into a match. The submission still gets
      // its provenance row recorded below (visible to admins as "also
      // submitted"), it just can't mutate the matched event.
      if (status !== 'pending') {
        const existing = await getEventRow(eventId)
        if (existing) {
          const patch = mergeFields(existing, raw)
          if (patch) await updateEventFields(eventId, patch)
        }
      }
    } else {
      // 3b. No match — new canonical event.
      eventId = await insertEvent(raw, { cityId, titleNorm, venueNorm, status })
    }
  }

  // 4. Provenance always (PRODUCT-SPEC §2.2.4).
  await recordProvenance({ eventId, source: raw.source, externalId: raw.source_id, url: raw.ticket_url, raw })

  return eventId
}
