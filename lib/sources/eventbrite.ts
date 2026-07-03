import type { RawEvent } from './types'

// Eventbrite shut off its public Event Search API (GET /v3/events/search/) to
// third parties on 2020-02-20 — a token no longer buys you a keyword/location
// search, so the old API approach returns nothing. Instead we scrape Eventbrite's
// own public discovery pages, which embed every listing as schema.org JSON-LD
// (<script type="application/ld+json"> → ItemList of Event objects). No token,
// no key: works with a plain HTTP GET. Returns [] on any failure so one bad run
// can't sink an ingest.
const AUSTIN_URL = 'https://www.eventbrite.com/d/tx--austin/all-events/'
const MAX_PAGES = 5 // ~20 events/page → up to ~100 events

// A real browser UA — Eventbrite's edge rejects blank/bot-like agents with 403.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

type LdAddress = {
  streetAddress?: string
  addressLocality?: string
  addressRegion?: string
  postalCode?: string
}
type LdOffer = { price?: string; lowPrice?: string; highPrice?: string }
type LdEvent = {
  '@type'?: string
  name?: string
  description?: string
  startDate?: string
  endDate?: string
  url?: string
  image?: string
  location?: { name?: string; address?: LdAddress }
  offers?: LdOffer | LdOffer[]
}

// "2026-07-04" (date-only) → an evening default so it doesn't land on the prior
// day once shifted to UTC. Full datetimes ("...T19:00:00-05:00") pass through.
function toStartIso(raw: string | undefined): string | null {
  if (!raw) return null
  const withTime = raw.includes('T') ? raw : `${raw}T19:00:00`
  const d = new Date(withTime)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function toEndIso(raw: string | undefined): string | null {
  if (!raw) return null
  const withTime = raw.includes('T') ? raw : `${raw}T23:00:00`
  const d = new Date(withTime)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// Eventbrite event URLs end in "...-tickets-1234567890"; that trailing number is
// the stable event id and makes the best dedup key. Fall back to the full URL.
function sourceIdFromUrl(url: string | undefined): string | null {
  if (!url) return null
  const m = url.match(/-(\d{6,})(?:\?|#|$)/)
  return m ? m[1] : url.split('?')[0]
}

function venueAddress(addr: LdAddress | undefined): string | null {
  if (!addr) return null
  const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion]
    .filter(Boolean)
    .join(', ')
  return parts || null
}

function priceOf(offers: LdEvent['offers']): { is_free: boolean; min: number | null; max: number | null } {
  if (!offers) return { is_free: false, min: null, max: null }
  const one: LdOffer = Array.isArray(offers) ? offers[0] ?? {} : offers
  const low = one.lowPrice ?? one.price
  const high = one.highPrice ?? one.price
  const min = low != null ? Number(low) : null
  const max = high != null ? Number(high) : null
  return {
    is_free: min === 0,
    min: min != null && !isNaN(min) ? min : null,
    max: max != null && !isNaN(max) ? max : null,
  }
}

// Pull every JSON-LD Event out of a page's HTML. Eventbrite wraps them in an
// ItemList, but we scan defensively for any Event node so a markup change in
// the wrapper doesn't silently zero us out.
function parseEventsFromHtml(html: string): LdEvent[] {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? []
  const events: LdEvent[] = []
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
    let data: unknown
    try {
      data = JSON.parse(json)
    } catch {
      continue
    }
    const roots = Array.isArray(data) ? data : [data]
    for (const root of roots) {
      const list = (root as { itemListElement?: Array<{ item?: LdEvent }> })?.itemListElement
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        const item = entry?.item
        if (item && item['@type'] === 'Event') events.push(item)
      }
    }
  }
  return events
}

export async function fetchEventbriteEvents(): Promise<RawEvent[]> {
  const results: RawEvent[] = []
  const seen = new Set<string>()

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${AUSTIN_URL}?page=${page}`
    let html: string
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(20000),
        cache: 'no-store',
      })
      if (!res.ok) {
        console.warn(`Eventbrite page ${page} returned HTTP ${res.status}`)
        break
      }
      html = await res.text()
    } catch (e) {
      console.error('Eventbrite fetch failed:', e)
      break
    }

    const events = parseEventsFromHtml(html)
    if (events.length === 0) break

    let added = 0
    for (const ev of events) {
      const start_time = toStartIso(ev.startDate)
      const source_id = sourceIdFromUrl(ev.url)
      if (!start_time || !source_id || seen.has(source_id)) continue
      seen.add(source_id)
      added++

      const price = priceOf(ev.offers)
      results.push({
        title: ev.name ?? 'Untitled',
        description: ev.description ?? null,
        start_time,
        end_time: toEndIso(ev.endDate),
        venue_name: ev.location?.name ?? null,
        venue_address: venueAddress(ev.location?.address),
        image_url: ev.image ?? null,
        ticket_url: ev.url ?? null,
        source: 'eventbrite',
        source_id,
        is_free: price.is_free,
        price_min: price.min,
        price_max: price.max,
      })
    }

    // A page of only duplicates means we've paged past fresh results.
    if (added === 0) break
  }

  return results
}
