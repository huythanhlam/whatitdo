import type { RawEvent } from './types'

// meetup.com/find/ is a Next.js page that's SERVER-rendered: live-verified
// (plain `curl`, no browser/JS) to embed a full Apollo GraphQL cache in
// <script id="__NEXT_DATA__"> at props.pageProps.__APOLLO_STATE__ — a flat
// map keyed by "Type:id" (e.g. "Event:315628987"), the same shape the site's
// own client hydrates from. So, like partiful.ts's __NEXT_DATA__ walk, this
// needs no Gemini and no BROWSER_FETCH_URL. Two wrinkles vs. partiful: (1)
// relations (group, displayPhoto, featuredEventPhoto) are cache refs
// (`{__ref: "PhotoInfo:X"}`), not inline objects, so they're resolved by
// looking the id up in the same flat map; (2) Meetup's own official API was
// deprecated in 2019 and now requires per-user OAuth, so this public,
// sitemap-listed find page (see meetup.com/robots.txt's find-usa-index-
// sitemap.xml) is the only unauthenticated path to Meetup event data.
//
// The bare find URL only returns Meetup's personalized "recommended nearby"
// feed — a fixed ~11 events regardless of radius (live-verified: 18/25/50/100
// miles all returned 10-11). Adding `&keywords=<topic>` switches the page to
// a real `eventSearch` GraphQL field with a much bigger pool per topic
// (live-verified: 12-32 events/topic). So, mirroring culturemap.ts's "one
// base URL, sweep N variants of it" shape (there: 14 day-tag pages; here: N
// topic-keyword pages), this fetches the bare page plus one page per topic in
// TOPIC_KEYWORDS and merges their Apollo caches before reducing to events —
// same-id entries collapse for free since the merged map is keyed by "Event:
// <id>". Live-verified across Meetup's own 16 topic tabs: 289 unique Austin
// events, vs. 11 from the bare page alone.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Meetup's own top-level topic taxonomy (the category tabs on /find/),
// live-verified via &keywords= to each pull a distinct, largely
// non-overlapping pool of events. Not exhaustive of Meetup's full category
// list (e.g. omits Travel & Outdoor's more niche siblings) — a representative
// sweep, not a guarantee of total coverage; add more topics here if a gap
// matters later.
export const TOPIC_KEYWORDS = [
  'social activities',
  'hobbies',
  'sports fitness',
  'outdoor',
  'business',
  'technology',
  'community',
  'games',
  'dancing',
  'music',
  'health wellbeing',
  'art culture',
  'science education',
  'pets animals',
  'writing',
  'family',
]

type ApolloRef = { __ref: string }
type ApolloState = Record<string, Record<string, unknown> | undefined>

function isRef(v: unknown): v is ApolloRef {
  return !!v && typeof v === 'object' && typeof (v as ApolloRef).__ref === 'string'
}

// Resolve a field that may be either a cache ref or (defensively) an inline
// object, by looking it up in the flat __APOLLO_STATE__ map.
function resolve(state: ApolloState, v: unknown): Record<string, unknown> | undefined {
  if (isRef(v)) return state[v.__ref]
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

type MeetupVenue = { name?: string; address?: string; city?: string; state?: string }
type MeetupFee = { amount?: number }

type MeetupEventNode = {
  __typename?: unknown
  id?: unknown
  title?: unknown
  description?: unknown
  dateTime?: unknown
  eventUrl?: unknown
  eventType?: unknown
  venue?: MeetupVenue
  feeSettings?: MeetupFee | null
  displayPhoto?: unknown
  featuredEventPhoto?: unknown
}

function isEventNode(v: unknown): v is MeetupEventNode {
  const o = v as MeetupEventNode
  return (
    !!o &&
    typeof o === 'object' &&
    o.__typename === 'Event' &&
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.dateTime === 'string'
  )
}

function venueOf(eventType: unknown, venue: MeetupVenue | undefined): { name: string | null; address: string | null } {
  if (eventType === 'ONLINE') return { name: 'Online', address: null }
  if (!venue?.name) return { name: null, address: null }
  const address = [venue.address, venue.city, venue.state].filter(Boolean).join(', ') || null
  return { name: venue.name, address }
}

function imageOf(state: ApolloState, node: MeetupEventNode): string | null {
  const photo = resolve(state, node.featuredEventPhoto) ?? resolve(state, node.displayPhoto)
  const url = photo?.highResUrl
  return typeof url === 'string' ? url : null
}

function toRawEvent(state: ApolloState, node: MeetupEventNode, source: string): RawEvent | null {
  const start = new Date(node.dateTime as string)
  if (isNaN(start.getTime())) return null

  const { name: venue_name, address: venue_address } = venueOf(node.eventType, node.venue)
  const fee = node.feeSettings
  const price = fee && typeof fee.amount === 'number' ? fee.amount : null

  return {
    title: (node.title as string).trim(),
    description: typeof node.description === 'string' ? node.description.trim() || null : null,
    start_time: start.toISOString(),
    end_time: null,
    venue_name,
    venue_address,
    image_url: imageOf(state, node),
    ticket_url: typeof node.eventUrl === 'string' ? node.eventUrl : null,
    source,
    source_id: node.id as string,
    is_free: price === null || price === 0,
    price_min: price,
    price_max: price,
  }
}

// Pure __APOLLO_STATE__ JSON -> events reduction (no network), so it's
// unit-testable without mocking fetch. Every Event entry in the flat cache
// map is a search-result hit — no need to walk pageProps' ROOT_QUERY edges,
// which only hold `__ref` pointers into this same map.
export function eventsFromApolloState(state: unknown, source: string): RawEvent[] {
  if (!state || typeof state !== 'object') return []
  const s = state as ApolloState
  const out: RawEvent[] = []
  for (const v of Object.values(s)) {
    if (isEventNode(v)) {
      const raw = toRawEvent(s, v, source)
      if (raw) out.push(raw)
    }
  }
  return out
}

// Pure URL derivation (no network) so it's unit-testable: adds/overrides the
// `keywords` param on the configured base find URL. Invalid base URLs (e.g. a
// non-URL DB misconfiguration) fall back to null rather than throwing.
export function keywordUrl(baseUrl: string, topic: string): string | null {
  try {
    const u = new URL(baseUrl)
    u.searchParams.set('keywords', topic)
    return u.toString()
  } catch {
    return null
  }
}

async function fetchApolloState(url: string): Promise<ApolloState | null> {
  let html: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    html = await res.text()
  } catch (e) {
    console.error(`Meetup fetch failed for ${url}:`, e)
    return null
  }

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null

  try {
    const data = JSON.parse(m[1]) as { props?: { pageProps?: { __APOLLO_STATE__?: unknown } } }
    const state = data?.props?.pageProps?.__APOLLO_STATE__
    return state && typeof state === 'object' ? (state as ApolloState) : null
  } catch (e) {
    console.error(`Meetup __NEXT_DATA__ parse failed for ${url}:`, e)
    return null
  }
}

// How many of the (1 + TOPIC_KEYWORDS.length) find pages to fetch at once.
// The sweep was originally strictly sequential ("no latency pressure to
// justify hammering meetup.com"), but that made its worst case 17 pages x the
// 20s per-fetch timeout = ~340s, which overran the ingest function's 300s
// maxDuration whenever meetup.com throttled the datacenter IP running the
// cron: every daily run was force-killed mid-sweep, so this source never
// persisted a single event and its source_runs row stayed stuck at 'running'.
// A small pool caps the worst case at ceil(N / FETCH_CONCURRENCY) x 20s
// (~60s for 17 pages) while staying far short of firing all 17 at once — a
// polite middle ground, since over-parallelizing risks the very throttling
// that caused the timeout.
const FETCH_CONCURRENCY = 6

// Bounded-concurrency map, kept local so this deliberately no-Gemini parser
// needs no import from lib/gemini (where the equivalent mapPool lives).
async function mapPool<T>(items: string[], limit: number, fn: (item: string) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

// Fetches the bare find page plus one `&keywords=<topic>` page per
// TOPIC_KEYWORDS with bounded concurrency, then merges their Apollo caches
// (merge order is immaterial — each id's entry is identical wherever it
// surfaces) before reducing to events once.
export async function fetchMeetupEvents(url: string, source: string): Promise<RawEvent[]> {
  const urls = [url, ...TOPIC_KEYWORDS.map(topic => keywordUrl(url, topic)).filter((u): u is string => u !== null)]

  const states = await mapPool(urls, FETCH_CONCURRENCY, fetchApolloState)

  const merged: ApolloState = {}
  for (const state of states) {
    if (state) Object.assign(merged, state)
  }

  return eventsFromApolloState(merged, source)
}
