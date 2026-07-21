import type { RawEvent } from './types'

// luma.com/<city-slug> (e.g. luma.com/austin) is a Next.js discover page
// whose own frontend calls a public, unauthenticated JSON endpoint
// (/discover/get-paginated-events) to fetch/paginate results. Luma's frontend
// hits the api.lu.ma host, but we hit the equivalent api.luma.com host, which
// serves the identical feed and — unlike api.lu.ma — is reachable from our
// iad1 cron datacenter (see buildPageUrl for the full rationale).
//
// Geo is pinned by `latitude`/`longitude` query params — and ONLY by those.
// Live-verified: the endpoint otherwise geo-locates by the caller's IP and
// ignores `place_api_id` for geo (passing Austin's, DC's, or NYC's place id
// from an Austin IP all return Austin events). The full param names are
// required: the short forms `lat`/`lng` are silently ignored. Passing a
// city's real coordinates overrides the IP bias (verified: NYC coords from an
// Austin IP return the NYC metro), which is what keeps this correct when the
// crawl runs from a datacenter region (our cron runs in iad1 / the DC metro).
// So this drives the paginated JSON API purely off the configured city's
// coordinates, following `has_more`/`next_cursor` to exhaustion — no HTML
// fetch, no place-id resolution, no Gemini, no BROWSER_FETCH_URL. `url` in the
// DB row is the human discover page (e.g. https://luma.com/austin), retained
// for the UI only; it is not fetched.
//
// Luma's discover feed has no per-event description field (only the
// calendar's own blurb, which isn't event-specific) — `description` is
// always null here, same as Meetup/Partiful's "when the source doesn't have
// it, don't invent it" convention.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Safety cap on cursor-following, mirroring paginated-crawl.ts's max_pages
// guard — Austin's full sweep is 3 pages (~120 events), but this keeps a much
// larger city from looping unbounded. Bounded together with PAGE_TIMEOUT_MS so
// the absolute worst case (MAX_PAGES * PAGE_TIMEOUT_MS = 100s) stays well under
// the ingest route's 300s maxDuration that this source shares with ~50 others:
// a slow/hanging Luma must fail this source cleanly, never run past the wall
// clock and orphan the whole invocation's source_run at 'running'.
const MAX_PAGES = 10
const PAGE_TIMEOUT_MS = 10000

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

// Full state-name → USPS code, for addresses Luma writes with the state
// spelled out (e.g. "Arlington, Virginia"). "washington dc" maps to DC; bare
// "washington" is the state (WA). Used only as a fallback when no trailing
// two-letter code is present.
const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC',
}

// The paginated geo search (see module comment) is a fuzzy radius, not a hard
// city boundary — it surfaces some events in a genuinely different city/state
// (e.g. a neighboring metro leaking into the feed). venue_address ends in a
// "City, ST [zip,] USA"-shaped tail when Luma has a real postal address, so a
// state mismatch there is a reliable signal. A trailing two-letter code is
// preferred; failing that, a spelled-out state name ("Arlington, Virginia") is
// resolved. An address that resolves to neither (or is absent, e.g. online
// events) is left alone rather than guessed at, since a false reject (hiding a
// real local event) is a worse failure than a rare unfiltered false positive.
export function stateFromAddress(address: string | null): string | null {
  if (!address) return null
  // Prefer an explicit trailing two-letter code ("…, TX", "…, DC", "…, VA").
  const code = address.match(/,\s*([A-Za-z]{2})\b/)
  if (code) return code[1].toUpperCase()
  // Fall back to a spelled-out state name in any comma-delimited segment,
  // stripping periods, digits (zip), and a trailing country so
  // "…, Virginia 22201, USA" still resolves.
  for (const seg of address.split(',')) {
    const norm = seg
      .toLowerCase()
      .replace(/\b(usa|united states)\b/g, '')
      .replace(/[.\d]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (STATE_NAMES[norm]) return STATE_NAMES[norm]
  }
  return null
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

// Pure builder for the paginated-events request URL, so param construction is
// unit-testable without network. Geo is pinned by latitude/longitude (full
// names only — Luma silently ignores the `lat`/`lng` short forms and otherwise
// geo-locates by the caller's IP).
export function buildPageUrl(lat: number, lng: number, cursor: string | null): string {
  // Host is api.luma.com, NOT api.lu.ma. Both serve the identical discover
  // JSON from a residential IP, but from our iad1 cron datacenter api.lu.ma
  // hangs (cloud-IP throttling) — each page stalled until the crawl blew past
  // the route's 300s maxDuration, orphaning the source_run at 'running' and
  // persisting nothing. api.luma.com is reachable and fast from iad1: it is
  // the same host the healthy crawl:luma-ics-austin source hits every day.
  const u = new URL('https://api.luma.com/discover/get-paginated-events')
  u.searchParams.set('latitude', String(lat))
  u.searchParams.set('longitude', String(lng))
  if (cursor) u.searchParams.set('pagination_cursor', cursor)
  return u.toString()
}

async function fetchPage(lat: number, lng: number, cursor: string | null): Promise<LumaPage | null> {
  try {
    const res = await fetch(buildPageUrl(lat, lng, cursor), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as LumaPage
  } catch (e) {
    console.error(`Luma fetch failed for ${lat},${lng}:`, e)
    return null
  }
}

export type LumaFetchOptions = { targetState?: string; lat: number | null; lng: number | null }

export async function fetchLumaEvents(url: string, source: string, opts: LumaFetchOptions): Promise<RawEvent[]> {
  const { targetState, lat, lng } = opts
  if (lat == null || lng == null) {
    // Fail closed: a coordinate-less crawl would fall back to IP geo — exactly
    // the DC-region leak this replaces. `url` is only the human discover page.
    console.error(`Luma ${source}: missing city coordinates (${url}); skipping`)
    return []
  }

  const merged: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(lat, lng, cursor)
    if (!data) break
    if (Array.isArray(data.entries)) merged.push(...data.entries)
    if (!data.has_more || typeof data.next_cursor !== 'string') break
    cursor = data.next_cursor
  }

  return eventsFromEntries(merged, source, targetState)
}
