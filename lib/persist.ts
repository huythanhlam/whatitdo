import { tagEvents } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import { getCategoryIdBySlug, upsertEvent, setEventCategories } from '@/lib/db'
import type { RawEvent } from '@/lib/sources/types'

// The single validation gate. A fabricated or nonsensical date is worse than no
// event — it actively misleads users — so an event is rejected (not persisted)
// when its start_time is missing/unparseable, its title is empty, or it starts
// more than 18 months out (a common symptom of a bad parse). This is the choke
// point: every source flows through persistEvents, so this bans fabricated dates
// repo-wide rather than per-scraper.
const MAX_FUTURE_MS = 18 * 30 * 24 * 60 * 60 * 1000 // ~18 months

export function isValidEvent(raw: RawEvent): boolean {
  if (!raw.title || raw.title.trim().length === 0) return false
  if (!raw.start_time) return false
  const t = new Date(raw.start_time).getTime()
  if (!Number.isFinite(t)) return false
  if (t > Date.now() + MAX_FUTURE_MS) return false
  return true
}

// Shared persistence pipeline used by both the scheduled ingest (/api/ingest)
// and the on-demand importer (/api/import): reject undateable events, tag the
// rest (batched Gemini, or keyword fallback), guarantee a themed image, then
// upsert with bounded concurrency and attach categories. Dedup is handled by
// the events table's UNIQUE(source, source_id) constraint.
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
  const CONCURRENCY = 8
  let cursor = 0

  async function processOne(raw: RawEvent, eventSlugs: (typeof slugs)[number]) {
    const eventId = await upsertEvent(raw)
    if (!eventId) {
      skipped++
      return
    }
    const categoryIds = eventSlugs.map(s => categoryIdBySlug[s]).filter(Boolean)
    await setEventCategories(eventId, categoryIds)
    inserted++
  }

  async function worker() {
    while (cursor < events.length) {
      const i = cursor++
      try {
        await processOne(events[i], slugs[i])
      } catch {
        skipped++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  return { inserted, skipped, rejected, total }
}
