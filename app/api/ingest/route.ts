import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchEventbriteEvents } from '@/lib/scrapers/eventbrite'
import { fetchAustinChronicleEvents } from '@/lib/scrapers/austin-chronicle'
import { fetchDo512Events } from '@/lib/scrapers/do512'
import { fetchIcalEvents } from '@/lib/scrapers/ical'
import { tagEvent } from '@/lib/tagger'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: categories } = await supabase.from('categories').select('id, slug')
  const categoryIdBySlug = Object.fromEntries((categories ?? []).map(c => [c.slug, c.id]))

  const [eventbrite, chronicle, do512, icalResult] = await Promise.allSettled([
    fetchEventbriteEvents(),
    fetchAustinChronicleEvents(),
    fetchDo512Events(),
    fetchIcalEvents(),
  ])

  const allEvents = [
    ...(eventbrite.status === 'fulfilled' ? eventbrite.value : []),
    ...(chronicle.status === 'fulfilled' ? chronicle.value : []),
    ...(do512.status === 'fulfilled' ? do512.value : []),
    ...(icalResult.status === 'fulfilled' ? icalResult.value : []),
  ]

  let inserted = 0
  let skipped = 0

  for (const raw of allEvents) {
    const { data: eventRow, error } = await supabase
      .from('events')
      .upsert({
        title: raw.title,
        description: raw.description,
        start_time: raw.start_time,
        end_time: raw.end_time,
        venue_name: raw.venue_name,
        venue_address: raw.venue_address,
        image_url: raw.image_url,
        ticket_url: raw.ticket_url,
        source: raw.source,
        source_id: raw.source_id,
        is_free: raw.is_free,
        price_min: raw.price_min,
        price_max: raw.price_max,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source,source_id' })
      .select('id')
      .single()

    if (error || !eventRow) { skipped++; continue }

    const slugs = await tagEvent(raw.title, raw.description)
    const categoryRows = slugs
      .map(slug => ({ event_id: eventRow.id, category_id: categoryIdBySlug[slug] }))
      .filter(r => r.category_id)

    if (categoryRows.length > 0) {
      await supabase.from('event_categories').upsert(categoryRows, { onConflict: 'event_id,category_id' })
    }

    inserted++
  }

  return NextResponse.json({ inserted, skipped, total: allEvents.length })
}

// Allow GET for manual testing
export async function GET(req: NextRequest) {
  return POST(req)
}
