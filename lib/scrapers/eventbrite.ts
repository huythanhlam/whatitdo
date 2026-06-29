import type { RawEvent } from './types'

export async function fetchEventbriteEvents(): Promise<RawEvent[]> {
  const token = process.env.EVENTBRITE_TOKEN
  if (!token) {
    console.warn('EVENTBRITE_TOKEN not set — skipping Eventbrite')
    return []
  }

  const results: RawEvent[] = []
  let pageNumber = 1
  let hasMore = true

  while (hasMore && pageNumber <= 5) {
    const url = new URL('https://www.eventbriteapi.com/v3/events/search/')
    url.searchParams.set('location.address', 'Austin, TX')
    url.searchParams.set('location.within', '25mi')
    url.searchParams.set('expand', 'venue,ticket_classes')
    url.searchParams.set('start_date.range_start', new Date().toISOString())
    url.searchParams.set('start_date.range_end', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())
    url.searchParams.set('page', String(pageNumber))

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) break

    const data = await res.json()

    for (const event of data.events ?? []) {
      const venue = event.venue
      results.push({
        title: event.name?.text ?? 'Untitled',
        description: event.description?.text ?? null,
        start_time: event.start?.utc ?? new Date().toISOString(),
        end_time: event.end?.utc ?? null,
        venue_name: venue?.name ?? null,
        venue_address: venue ? `${venue.address?.address_1 ?? ''}, ${venue.address?.city ?? 'Austin'}` : null,
        image_url: event.logo?.url ?? null,
        ticket_url: event.url ?? null,
        source: 'eventbrite',
        source_id: event.id,
        is_free: event.is_free ?? false,
        price_min: event.ticket_classes?.[0]?.cost?.major_value
          ? parseFloat(event.ticket_classes[0].cost.major_value) : null,
        price_max: event.ticket_classes?.at(-1)?.cost?.major_value
          ? parseFloat(event.ticket_classes.at(-1).cost.major_value) : null,
      })
    }

    hasMore = data.pagination?.has_more_items ?? false
    pageNumber++
  }

  return results
}
