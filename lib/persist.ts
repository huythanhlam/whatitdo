import { tagEvents } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import { getCategoryIdBySlug, upsertEvent, setEventCategories } from '@/lib/db'
import type { RawEvent } from '@/lib/scrapers/types'

// Shared persistence pipeline used by both the scheduled ingest (/api/ingest)
// and the on-demand importer (/api/import): tag every event (batched Gemini, or
// keyword fallback), guarantee a themed image, then upsert with bounded
// concurrency and attach categories. Dedup is handled by the events table's
// UNIQUE(source, source_id) constraint.
export async function persistEvents(events: RawEvent[]): Promise<{ inserted: number; skipped: number; total: number }> {
  if (events.length === 0) return { inserted: 0, skipped: 0, total: 0 }

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

  return { inserted, skipped, total: events.length }
}
