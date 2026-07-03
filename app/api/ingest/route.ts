import { NextRequest, NextResponse } from 'next/server'
import { fetchEventbriteEvents } from '@/lib/scrapers/eventbrite'
import { fetchAustinChronicleEvents } from '@/lib/scrapers/austin-chronicle'
import { fetchDo512Events } from '@/lib/scrapers/do512'
import { fetchIcalEvents } from '@/lib/scrapers/ical'
import { fetchTicketmasterEvents } from '@/lib/scrapers/ticketmaster'
import { fetchSeatGeekEvents } from '@/lib/scrapers/seatgeek'
import { fetchNewspaperEvents } from '@/lib/scrapers/newspapers'
import { fetchSocialEvents } from '@/lib/scrapers/social'
import { fetchYoutubeEvents } from '@/lib/scrapers/youtube'
import { fetchCrawlEvents } from '@/lib/scrapers/crawler'
import { fetchSeedEvents } from '@/lib/scrapers/seed'
import { persistEvents } from '@/lib/persist'
import { isLocal } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

async function runIngest() {
  const sources = [
    { name: 'eventbrite', fetch: fetchEventbriteEvents },
    { name: 'austin-chronicle', fetch: fetchAustinChronicleEvents },
    { name: 'do512', fetch: fetchDo512Events },
    { name: 'ical', fetch: fetchIcalEvents },
    { name: 'ticketmaster', fetch: fetchTicketmasterEvents },
    { name: 'seatgeek', fetch: fetchSeatGeekEvents },
    { name: 'newspapers', fetch: fetchNewspaperEvents },
    { name: 'social', fetch: fetchSocialEvents },
    { name: 'youtube', fetch: fetchYoutubeEvents },
    { name: 'crawl', fetch: fetchCrawlEvents },
    { name: 'seed', fetch: fetchSeedEvents },
  ]

  const settled = await Promise.allSettled(sources.map(s => s.fetch()))

  // Per-source counts so the response shows where events came from (and which
  // feeds returned nothing this run).
  const bySource: Record<string, number> = {}
  const allEvents = settled.flatMap((res, i) => {
    const events = res.status === 'fulfilled' ? res.value : []
    bySource[sources[i].name] = events.length
    if (res.status === 'rejected') console.error(`Source ${sources[i].name} failed:`, res.reason)
    return events
  })

  // Tag (batched Gemini or keyword fallback), assign images, and upsert.
  const { inserted, skipped } = await persistEvents(allEvents)

  const geminiRequests = process.env.GEMINI_API_KEY ? Math.ceil(allEvents.length / 25) : 0
  return NextResponse.json({
    inserted, skipped, total: allEvents.length,
    bySource, geminiRequests, mode: isLocal() ? 'local' : 'supabase',
  })
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}

// Vercel Cron invokes scheduled jobs with a GET request (carrying the
// CRON_SECRET bearer), so GET must be supported — it is guarded identically.
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  return runIngest()
}
