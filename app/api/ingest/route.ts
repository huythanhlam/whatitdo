import { NextRequest, NextResponse } from 'next/server'
import { fetchEventbriteEvents } from '@/lib/scrapers/eventbrite'
import { fetchAustinChronicleEvents } from '@/lib/scrapers/austin-chronicle'
import { fetchDo512Events } from '@/lib/scrapers/do512'
import { fetchIcalEvents } from '@/lib/scrapers/ical'
import { fetchTicketmasterEvents } from '@/lib/scrapers/ticketmaster'
import { fetchSeatGeekEvents } from '@/lib/scrapers/seatgeek'
import { fetchSeedEvents } from '@/lib/scrapers/seed'
import { tagEvent } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import { getCategoryIdBySlug, upsertEvent, setEventCategories, isLocal } from '@/lib/db'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  // In local mode (no Supabase / no CRON_SECRET) the route is open for easy
  // testing; in production it requires the CRON_SECRET bearer token.
  if (!isLocal() || process.env.CRON_SECRET) {
    const authHeader = req.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const categoryIdBySlug = await getCategoryIdBySlug()

  const [eventbrite, chronicle, do512, icalResult, ticketmaster, seatgeek, seed] = await Promise.allSettled([
    fetchEventbriteEvents(),
    fetchAustinChronicleEvents(),
    fetchDo512Events(),
    fetchIcalEvents(),
    fetchTicketmasterEvents(),
    fetchSeatGeekEvents(),
    fetchSeedEvents(),
  ])

  const allEvents = [
    ...(eventbrite.status === 'fulfilled' ? eventbrite.value : []),
    ...(chronicle.status === 'fulfilled' ? chronicle.value : []),
    ...(do512.status === 'fulfilled' ? do512.value : []),
    ...(icalResult.status === 'fulfilled' ? icalResult.value : []),
    ...(ticketmaster.status === 'fulfilled' ? ticketmaster.value : []),
    ...(seatgeek.status === 'fulfilled' ? seatgeek.value : []),
    ...(seed.status === 'fulfilled' ? seed.value : []),
  ]

  let inserted = 0
  let skipped = 0

  // Process events with bounded concurrency — hundreds of events tagged one at a
  // time would blow the function timeout. CONCURRENCY workers drain the queue.
  const CONCURRENCY = 8
  let cursor = 0

  async function processOne(raw: (typeof allEvents)[number]) {
    // Tag first so the image fallback can pick a category-themed image, then
    // guarantee every event has an image before storing it.
    const slugs = await tagEvent(raw.title, raw.description)
    if (!raw.image_url) raw.image_url = imageForCategories(slugs)

    const eventId = await upsertEvent(raw)
    if (!eventId) { skipped++; return }

    const categoryIds = slugs.map(s => categoryIdBySlug[s]).filter(Boolean)
    await setEventCategories(eventId, categoryIds)
    inserted++
  }

  async function worker() {
    while (cursor < allEvents.length) {
      const raw = allEvents[cursor++]
      try {
        await processOne(raw)
      } catch {
        skipped++
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  return NextResponse.json({ inserted, skipped, total: allEvents.length, mode: isLocal() ? 'local' : 'supabase' })
}

// Allow GET for manual testing
export async function GET(req: NextRequest) {
  return POST(req)
}
