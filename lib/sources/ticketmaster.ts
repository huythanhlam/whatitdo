import type { RawEvent } from './types'

// Ticketmaster Discovery API — image-rich Austin events. Free key at
// https://developer.ticketmaster.com. Returns [] when no key is configured.
type TmImage = { url: string; ratio?: string; width?: number }

function bestImage(images: TmImage[] | undefined): string | null {
  if (!images || images.length === 0) return null
  const wide = images.filter(i => i.ratio === '16_9')
  const pool = wide.length > 0 ? wide : images
  return pool.reduce((best, i) => (i.width ?? 0) > (best.width ?? 0) ? i : best).url ?? null
}

export async function fetchTicketmasterEvents(city: { name: string; state: string }): Promise<RawEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY
  if (!apiKey) {
    console.warn('TICKETMASTER_API_KEY not set — skipping Ticketmaster')
    return []
  }

  const results: RawEvent[] = []

  for (let page = 0; page < 3; page++) {
    const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json')
    url.searchParams.set('apikey', apiKey)
    url.searchParams.set('city', city.name)
    url.searchParams.set('stateCode', city.state)
    url.searchParams.set('size', '100')
    url.searchParams.set('sort', 'date,asc')
    url.searchParams.set('page', String(page))

    let data: Record<string, unknown>
    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) })
      if (!res.ok) break
      data = await res.json()
    } catch (e) {
      console.error('Ticketmaster fetch failed:', e)
      break
    }

    const embedded = data._embedded as { events?: Record<string, unknown>[] } | undefined
    const events = embedded?.events ?? []
    if (events.length === 0) break

    for (const ev of events) {
      const dates = ev.dates as { start?: { dateTime?: string; localDate?: string } } | undefined
      const start = dates?.start?.dateTime ?? (dates?.start?.localDate ? `${dates.start.localDate}T19:00:00Z` : null)
      if (!start) continue

      const venues = (ev._embedded as { venues?: Record<string, unknown>[] } | undefined)?.venues
      const venue = venues?.[0] as { name?: string; address?: { line1?: string }; city?: { name?: string } } | undefined
      const priceRanges = ev.priceRanges as { min?: number; max?: number }[] | undefined

      results.push({
        title: (ev.name as string) ?? 'Untitled',
        description: (ev.info as string) ?? (ev.pleaseNote as string) ?? null,
        start_time: new Date(start).toISOString(),
        end_time: null,
        venue_name: venue?.name ?? null,
        venue_address: venue ? `${venue.address?.line1 ?? ''}, ${venue.city?.name ?? city.name}`.trim() : null,
        image_url: bestImage(ev.images as TmImage[] | undefined),
        ticket_url: (ev.url as string) ?? null,
        source: 'ticketmaster',
        source_id: ev.id as string,
        is_free: false,
        price_min: priceRanges?.[0]?.min ?? null,
        price_max: priceRanges?.[0]?.max ?? null,
      })
    }

    const pageInfo = data.page as { totalPages?: number } | undefined
    if (pageInfo?.totalPages !== undefined && page >= pageInfo.totalPages - 1) break
  }

  return results
}
