import { NextRequest, NextResponse } from 'next/server'
import { fetchEventbriteEvents } from '@/lib/scrapers/eventbrite'
import { fetchAustinChronicleEvents } from '@/lib/scrapers/austin-chronicle'
import { fetchDo512Events } from '@/lib/scrapers/do512'
import { fetchIcalEvents } from '@/lib/scrapers/ical'
import { fetchSeedEvents } from '@/lib/scrapers/seed'
import { tagEvent } from '@/lib/tagger'
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

  const [eventbrite, chronicle, do512, icalResult, seed] = await Promise.allSettled([
    fetchEventbriteEvents(),
    fetchAustinChronicleEvents(),
    fetchDo512Events(),
    fetchIcalEvents(),
    fetchSeedEvents(),
  ])

  const allEvents = [
    ...(eventbrite.status === 'fulfilled' ? eventbrite.value : []),
    ...(chronicle.status === 'fulfilled' ? chronicle.value : []),
    ...(do512.status === 'fulfilled' ? do512.value : []),
    ...(icalResult.status === 'fulfilled' ? icalResult.value : []),
    ...(seed.status === 'fulfilled' ? seed.value : []),
  ]

  let inserted = 0
  let skipped = 0

  for (const raw of allEvents) {
    const eventId = await upsertEvent(raw)
    if (!eventId) { skipped++; continue }

    const slugs = await tagEvent(raw.title, raw.description)
    const categoryIds = slugs.map(s => categoryIdBySlug[s]).filter(Boolean)
    await setEventCategories(eventId, categoryIds)

    inserted++
  }

  return NextResponse.json({ inserted, skipped, total: allEvents.length, mode: isLocal() ? 'local' : 'supabase' })
}

// Allow GET for manual testing
export async function GET(req: NextRequest) {
  return POST(req)
}
