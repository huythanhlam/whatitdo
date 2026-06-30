import type { RawEvent } from './types'

// SeatGeek API — Austin events with performer images. Free client_id at
// https://seatgeek.com/account/develop. Returns [] when no key is configured.
type SgPerformer = { image?: string | null; images?: { huge?: string; large?: string } }

function performerImage(performers: SgPerformer[] | undefined): string | null {
  const p = performers?.[0]
  return p?.image ?? p?.images?.huge ?? p?.images?.large ?? null
}

export async function fetchSeatGeekEvents(): Promise<RawEvent[]> {
  const clientId = process.env.SEATGEEK_CLIENT_ID
  if (!clientId) {
    console.warn('SEATGEEK_CLIENT_ID not set — skipping SeatGeek')
    return []
  }

  const results: RawEvent[] = []

  for (let page = 1; page <= 3; page++) {
    const url = new URL('https://api.seatgeek.com/2/events')
    url.searchParams.set('venue.city', 'Austin')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))
    url.searchParams.set('sort', 'datetime_utc.asc')

    let data: Record<string, unknown>
    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) })
      if (!res.ok) break
      data = await res.json()
    } catch (e) {
      console.error('SeatGeek fetch failed:', e)
      break
    }

    const events = (data.events as Record<string, unknown>[] | undefined) ?? []
    if (events.length === 0) break

    for (const ev of events) {
      const start = (ev.datetime_utc as string | null) ?? (ev.datetime_local as string | null)
      if (!start) continue

      const venue = ev.venue as { name?: string; display_location?: string } | undefined
      const stats = ev.stats as { lowest_price?: number | null; highest_price?: number | null } | undefined

      results.push({
        title: (ev.title as string) ?? 'Untitled',
        description: (ev.description as string) || null,
        start_time: new Date(start.endsWith('Z') ? start : `${start}Z`).toISOString(),
        end_time: null,
        venue_name: venue?.name ?? null,
        venue_address: venue?.display_location ?? null,
        image_url: performerImage(ev.performers as SgPerformer[] | undefined),
        ticket_url: (ev.url as string) ?? null,
        source: 'seatgeek',
        source_id: String(ev.id),
        is_free: false,
        price_min: stats?.lowest_price ?? null,
        price_max: stats?.highest_price ?? null,
      })
    }
  }

  return results
}
