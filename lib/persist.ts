import { tagEvents } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import {
  getCategoryIdBySlug, setEventCategories,
  findEventBySource, findDedupCandidates, insertEvent,
  getEventRow, updateEventFields, recordProvenance,
} from '@/lib/db'
import { normalizeTitle, normalizeVenue } from '@/lib/normalize'
import { chooseMatch, mergeFields } from '@/lib/dedup'
import type { RawEvent } from '@/lib/sources/types'

// Austin until Phase 3 wires multi-city through the ingest context. Matches the
// events.city_id default from migration 007.
const CITY_ID = 1

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

// Shared persistence pipeline used by both the scheduled ingest (/api/ingest) and
// the on-demand importer (/api/import). Per event: reject undateable input, tag
// (batched Gemini or keyword fallback), guarantee a themed image, then run
// cross-source dedup (block → score → merge → provenance) so the same event from
// multiple sources collapses into one canonical row. `inserted` counts every
// event successfully persisted — whether newly created or merged into an existing
// canonical row — preserving the return shape the ingest orchestrator records as
// events_upserted.
export async function persistEvents(
  input: RawEvent[]
): Promise<{ inserted: number; skipped: number; rejected: number; total: number }> {
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

  let inserted = 0
  let skipped = 0

  // Dedup mutates shared candidate state (an event inserted by one item can match
  // the next), so persist sequentially rather than with a concurrency pool.
  // Ingest already runs sources concurrently; within a source, order matters.
  for (let i = 0; i < events.length; i++) {
    try {
      const eventId = await persistOne(events[i], CITY_ID)
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
async function persistOne(raw: RawEvent, cityId: number): Promise<string> {
  const titleNorm = normalizeTitle(raw.title, raw.venue_name)
  const venueNorm = normalizeVenue(raw.venue_name)

  // 1. Idempotency: already seen this exact (source, external_id)?
  let eventId = await findEventBySource(raw.source, raw.source_id)

  if (eventId) {
    // Same source re-ingested — merge any newly-richer fields in place.
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
      const existing = await getEventRow(eventId)
      if (existing) {
        const patch = mergeFields(existing, raw)
        if (patch) await updateEventFields(eventId, patch)
      }
    } else {
      // 3b. No match — new canonical event.
      eventId = await insertEvent(raw, { cityId, titleNorm, venueNorm })
    }
  }

  // 4. Provenance always (PRODUCT-SPEC §2.2.4).
  await recordProvenance({ eventId, source: raw.source, externalId: raw.source_id, url: raw.ticket_url, raw })

  return eventId
}
