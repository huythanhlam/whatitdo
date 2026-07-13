import type { RawEvent } from './types'

// luma.com/<city-slug> (e.g. luma.com/austin) is a Next.js discover page,
// server-rendered enough to embed the first page of results in
// __NEXT_DATA__ — but that same page also calls a public, unauthenticated
// JSON endpoint (api.lu.ma/discover/get-paginated-events?slug=<city-slug>)
// to fetch/paginate results, live-verified via plain `curl` to return the
// identical event shape wrapped in `entries[]`, plus a `ticket_info` block
// (price/is_free) the __NEXT_DATA__ payload's own event objects don't carry.
// So, rather than scraping HTML, this hits that JSON endpoint directly and
// follows its `has_more`/`next_cursor` pagination — no Gemini, no
// BROWSER_FETCH_URL, same tier as meetup.ts/partiful.ts. `url` in the DB row
// is the human discover page (e.g. https://luma.com/austin); the slug is
// derived from its path so the row stays a clickable, human-verifiable link
// like every other source's `url`.
//
// Luma's discover feed has no per-event description field (only the
// calendar's own blurb, which isn't event-specific) — `description` is
// always null here, same as Meetup/Partiful's "when the source doesn't have
// it, don't invent it" convention.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Safety cap on cursor-following, mirroring paginated-crawl.ts's max_pages
// guard — Austin's whole discover feed is one page (~21 events, has_more:
// false), but this keeps a future larger city from looping unbounded.
const MAX_PAGES = 20

type LumaPrice = { cents?: unknown; currency?: unknown }
type LumaTicketInfo = { price?: LumaPrice | null; is_free?: unknown }
type LumaGeoAddressInfo = {
  address?: unknown
  full_address?: unknown
  short_address?: unknown
  city_state?: unknown
}
type LumaEventNode = {
  api_id?: unknown
  name?: unknown
  start_at?: unknown
  end_at?: unknown
  url?: unknown
  location_type?: unknown
  geo_address_info?: LumaGeoAddressInfo
  cover_url?: unknown
  social_image_url?: unknown
}
type LumaEntry = {
  event?: LumaEventNode
  ticket_info?: LumaTicketInfo | null
}
type LumaPage = { entries?: unknown; has_more?: unknown; next_cursor?: unknown }

function isLumaEntry(v: unknown): v is LumaEntry {
  const o = v as LumaEntry
  const ev = o?.event
  return (
    !!ev &&
    typeof ev === 'object' &&
    typeof ev.api_id === 'string' &&
    typeof ev.name === 'string' &&
    typeof ev.start_at === 'string'
  )
}

function venueOf(ev: LumaEventNode): { name: string | null; address: string | null } {
  if (ev.location_type === 'online') return { name: 'Online', address: null }
  const geo = ev.geo_address_info
  const name = typeof geo?.address === 'string' ? geo.address : null
  const address =
    (typeof geo?.full_address === 'string' && geo.full_address) ||
    (typeof geo?.short_address === 'string' && geo.short_address) ||
    (typeof geo?.city_state === 'string' && geo.city_state) ||
    null
  return { name, address }
}

// Luma prices are integer cents; RawEvent.price_min/max are dollar amounts
// (matching every other source and the UI's `$${price_min}` rendering).
function priceOf(ticket: LumaTicketInfo | null | undefined): number | null {
  const cents = ticket?.price?.cents
  return typeof cents === 'number' ? cents / 100 : null
}

function toIso(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function toRawEvent(entry: LumaEntry, source: string): RawEvent | null {
  const ev = entry.event!
  const start_time = toIso(ev.start_at)
  if (!start_time) return null

  const { name: venue_name, address: venue_address } = venueOf(ev)
  const price = priceOf(entry.ticket_info)
  const is_free = entry.ticket_info?.is_free !== undefined ? !!entry.ticket_info.is_free : price === null

  return {
    title: (ev.name as string).trim(),
    description: null,
    start_time,
    end_time: toIso(ev.end_at),
    venue_name,
    venue_address,
    image_url: (typeof ev.cover_url === 'string' && ev.cover_url) || (typeof ev.social_image_url === 'string' && ev.social_image_url) || null,
    ticket_url: typeof ev.url === 'string' ? `https://luma.com/${ev.url}` : null,
    source,
    source_id: ev.api_id as string,
    is_free,
    price_min: price,
    price_max: price,
  }
}

// Pure entries[] -> events reduction (no network), so it's unit-testable
// without mocking fetch. Dedupes by id since cursor pages aren't guaranteed
// disjoint (mirrors meetup.ts's merged-map dedup).
export function eventsFromEntries(entries: unknown, source: string): RawEvent[] {
  if (!Array.isArray(entries)) return []
  const seen = new Map<string, RawEvent>()
  for (const e of entries) {
    if (!isLumaEntry(e) || seen.has(e.event!.api_id as string)) continue
    const raw = toRawEvent(e, source)
    if (raw) seen.set(e.event!.api_id as string, raw)
  }
  return [...seen.values()]
}

// Pure URL -> slug derivation (no network) so it's unit-testable: takes the
// last non-empty path segment of the configured discover page URL (e.g.
// https://luma.com/austin -> "austin"). Falls back to null for an
// unparseable or path-less URL rather than throwing.
export function slugFromUrl(pageUrl: string): string | null {
  try {
    const segments = new URL(pageUrl).pathname.split('/').filter(Boolean)
    return segments.length > 0 ? segments[segments.length - 1] : null
  } catch {
    return null
  }
}

async function fetchPage(slug: string, cursor: string | null): Promise<LumaPage | null> {
  const u = new URL('https://api.lu.ma/discover/get-paginated-events')
  u.searchParams.set('slug', slug)
  if (cursor) u.searchParams.set('pagination_cursor', cursor)

  try {
    const res = await fetch(u, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as LumaPage
  } catch (e) {
    console.error(`Luma fetch failed for ${u}:`, e)
    return null
  }
}

export async function fetchLumaEvents(url: string, source: string): Promise<RawEvent[]> {
  const slug = slugFromUrl(url)
  if (!slug) return []

  const merged: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(slug, cursor)
    if (!data) break
    if (Array.isArray(data.entries)) merged.push(...data.entries)
    if (!data.has_more || typeof data.next_cursor !== 'string') break
    cursor = data.next_cursor
  }

  return eventsFromEntries(merged, source)
}
