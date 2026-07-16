import type { RawEvent } from './types'

// luma.com/<city-slug> (e.g. luma.com/austin) is a Next.js discover page
// whose own frontend calls a public, unauthenticated JSON endpoint
// (api.lu.ma/discover/get-paginated-events) to fetch/paginate results. Live-
// verified via plain `curl` that this endpoint takes two different geo
// params with very different reach:
//   - `slug=<city-slug>`: the page's own curated "Popular events" feed —
//     capped at a small fixed set (Austin: 21) with `has_more` always false,
//     regardless of `categories=<topic>` filters (verified: every one of
//     Luma's 8 discover-page category tabs returns a strict SUBSET of that
//     same 21, never anything new — so, unlike Meetup, sweeping categories
//     buys nothing here).
//   - `place_api_id=<discplace-id>`: the same underlying geo search, but
//     genuinely paginated (`has_more`/`next_cursor`) — verified to return
//     120 unique events for Austin (a strict superset of the 21 from
//     `slug`), spanning the greater metro (Round Rock, Cedar Park,
//     Georgetown, Leander, Pflugerville) roughly 8 months out.
// So this fetches the discover page's HTML once per city to read its
// embedded __NEXT_DATA__ place.api_id (the id isn't derivable from the URL
// or returned by the paginated-events endpoint itself), then drives the JSON
// API off that id, following pagination to exhaustion. No Gemini, no
// BROWSER_FETCH_URL — same tier as meetup.ts/partiful.ts. `url` in the DB
// row is the human discover page (e.g. https://luma.com/austin); if place-id
// resolution ever fails, this falls back to the slug-based (smaller but
// still real) feed rather than returning nothing.
//
// Luma's discover feed has no per-event description field (only the
// calendar's own blurb, which isn't event-specific) — `description` is
// always null here, same as Meetup/Partiful's "when the source doesn't have
// it, don't invent it" convention.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Safety cap on cursor-following, mirroring paginated-crawl.ts's max_pages
// guard — Austin's full place_api_id sweep is 3 pages (120 events), but this
// keeps a much larger city from looping unbounded.
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

// The place_api_id geo search (see module comment) is a fuzzy radius search,
// not a hard city boundary — it has been observed to surface events whose
// geo_address_info is a genuinely different city/state (e.g. DC events
// leaking into the Austin feed). venue_address always ends in a "City, ST
// [zip,] USA"-shaped tail when Luma has a real postal address, so a mismatch
// there is a reliable signal; an address that doesn't parse (or is absent,
// e.g. online events) is left alone rather than guessed at, since a false
// reject (hiding a real local event) is a worse failure than a rare
// unfiltered false positive.
function stateFromAddress(address: string | null): string | null {
  if (!address) return null
  const m = address.match(/,\s*([A-Za-z]{2})\b/)
  return m ? m[1].toUpperCase() : null
}

// Pure entries[] -> events reduction (no network), so it's unit-testable
// without mocking fetch. Dedupes by id since cursor pages aren't guaranteed
// disjoint (mirrors meetup.ts's merged-map dedup). `targetState` (the
// configured city's two-letter state code) drops any entry whose address
// resolves to a different state; omit it to skip this check entirely.
export function eventsFromEntries(entries: unknown, source: string, targetState?: string): RawEvent[] {
  if (!Array.isArray(entries)) return []
  const seen = new Map<string, RawEvent>()
  for (const e of entries) {
    if (!isLumaEntry(e) || seen.has(e.event!.api_id as string)) continue
    const raw = toRawEvent(e, source)
    if (!raw) continue
    if (targetState) {
      const state = stateFromAddress(raw.venue_address)
      if (state && state !== targetState.toUpperCase()) continue
    }
    seen.set(e.event!.api_id as string, raw)
  }
  return [...seen.values()]
}

// Pure URL -> slug derivation (no network) so it's unit-testable: takes the
// last non-empty path segment of the configured discover page URL (e.g.
// https://luma.com/austin -> "austin"). Falls back to null for an
// unparseable or path-less URL rather than throwing. Only used as the
// fallback geo param when place-id resolution fails.
export function slugFromUrl(pageUrl: string): string | null {
  try {
    const segments = new URL(pageUrl).pathname.split('/').filter(Boolean)
    return segments.length > 0 ? segments[segments.length - 1] : null
  } catch {
    return null
  }
}

// Pure __NEXT_DATA__ JSON -> place id extraction (no network), so it's
// unit-testable without mocking fetch.
export function placeApiIdFromNextData(data: unknown): string | null {
  const apiId = (data as { props?: { pageProps?: { initialData?: { data?: { place?: { api_id?: unknown } } } } } })
    ?.props?.pageProps?.initialData?.data?.place?.api_id
  return typeof apiId === 'string' ? apiId : null
}

// Fetches the discover page's HTML once to read its embedded place.api_id —
// the id that unlocks the full paginated search (see module comment). Not
// itself the event data; just a one-time lookup per city.
async function resolvePlaceApiId(pageUrl: string): Promise<string | null> {
  let html: string
  try {
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    html = await res.text()
  } catch (e) {
    console.error(`Luma place-id fetch failed for ${pageUrl}:`, e)
    return null
  }

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null

  try {
    return placeApiIdFromNextData(JSON.parse(m[1]))
  } catch (e) {
    console.error(`Luma __NEXT_DATA__ parse failed for ${pageUrl}:`, e)
    return null
  }
}

async function fetchPage(geoParam: [string, string], cursor: string | null): Promise<LumaPage | null> {
  const u = new URL('https://api.lu.ma/discover/get-paginated-events')
  u.searchParams.set(...geoParam)
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

export async function fetchLumaEvents(url: string, source: string, targetState?: string): Promise<RawEvent[]> {
  const placeApiId = await resolvePlaceApiId(url)
  const slug = slugFromUrl(url)
  const geoParam: [string, string] | null = placeApiId ? ['place_api_id', placeApiId] : slug ? ['slug', slug] : null
  if (!geoParam) return []

  const merged: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(geoParam, cursor)
    if (!data) break
    if (Array.isArray(data.entries)) merged.push(...data.entries)
    if (!data.has_more || typeof data.next_cursor !== 'string') break
    cursor = data.next_cursor
  }

  return eventsFromEntries(merged, source, targetState)
}
