import type { RawEvent } from './types'
import { TZ, zonedToUtc, partsInTz } from '@/lib/dateRanges'

// austinmonthly.com/calendar/ — a WordPress "Event Calendar Pro" custom
// calendar. The listing is served 10 events at a time behind an admin-ajax
// "load more" action (austin_get_more_events), and every event's richer detail
// lives in a schema.org Event JSON-LD block on its own /events/<slug>/ page.
// So this parser is two structured passes, no Gemini: (1) paginate the AJAX
// endpoint to collect each event's listing card (URL, title, and — crucially —
// its in-window date/time), then (2) fetch each detail page for venue, price,
// description and image.
//
// WHY the listing supplies the date, not the JSON-LD: for a recurring or
// multi-day event the detail page's JSON-LD `startDate` is the SERIES start
// (often long past — e.g. a 2019 or 2025 date for something still running),
// whereas the listing card shows the occurrence's date within the queried
// window. Using the listing date keeps "currently on" events dated correctly;
// the JSON-LD is only a fallback for the time-of-day. All datetimes are the
// site's local wall clock with no zone, so they're read as America/Chicago.

const AJAX_URL = 'https://www.austinmonthly.com/wp-admin/admin-ajax.php'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Each AJAX page is 10 events; 40 pages (~400 events) comfortably covers the
// rolling window's real volume (~250 events/month, live-verified) with buffer,
// while capping a runaway listing. Overridable per-source via sources.max_pages.
const DEFAULT_MAX_PAGES = 40
// How far ahead the rolling window reaches. The calendar filters by an explicit
// start/end date; a ~5-week window keeps each daily run bounded while staying
// ahead of "this month" browsing.
const WINDOW_DAYS = 35
// Time-of-day for an all-day listing card that carries no clock time. Noon
// local avoids a midnight start reading as the previous evening in some views.
const ALL_DAY_HOUR = 12
// Detail pages are independent GETs; a small pool keeps the run fast without
// hammering the origin.
const DETAIL_CONCURRENCY = 8
const LISTING_TIMEOUT_MS = 30000
const DETAIL_TIMEOUT_MS = 20000

// --- pure helpers (network-free, unit-tested) --------------------------------

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

// "July 19, 2026" -> { y: 2026, m: 6 (0-based), d: 19 }. Returns null if it
// isn't a full month-name date.
export function parseLongDate(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/)
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  if (month === undefined) return null
  return { y: parseInt(m[3], 10), m: month, d: parseInt(m[2], 10) }
}

// "7:00 am" / "10:00 PM" -> 24h { hh, mm }. Returns null otherwise.
export function parseClockTime(s: string | null | undefined): { hh: number; mm: number } | null {
  if (!s) return null
  const m = s.match(/(\d{1,2}):(\d{2})\s*([ap]m)/i)
  if (!m) return null
  let hh = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  const pm = m[3].toLowerCase() === 'pm'
  if (hh === 12) hh = pm ? 12 : 0
  else if (pm) hh += 12
  if (hh > 23 || mm > 59) return null
  return { hh, mm }
}

export type ListingItem = {
  url: string
  title: string | null
  date: string | null // raw "July 19, 2026"
  startClock: string | null // raw "7:00 am"
  endClock: string | null // raw "10:00 am"
  image: string | null
}

// Split an <span class="ecp-event-time"> inner text (tags stripped to leave
// literal "|" / "-" separators, e.g. "July 19, 2026|7:00 am-10:00 am" or a
// "Jul 19, 2026 - Dec 31, 2026|8:00 am-7:00 pm" range) into its first date and
// its start/end clock strings.
function parseEcpTime(text: string): { date: string | null; startClock: string | null; endClock: string | null } {
  const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const [datePart, timePart = ''] = clean.split('|')
  const dateMatch = datePart.match(/[A-Za-z]+\s+\d{1,2},\s*\d{4}/)
  const times = timePart.split('-').map(t => t.trim()).filter(Boolean)
  return { date: dateMatch ? dateMatch[0] : null, startClock: times[0] ?? null, endClock: times[1] ?? null }
}

// Parse each event card out of one AJAX "events" HTML fragment.
export function parseListingItems(eventsHtml: string): ListingItem[] {
  const items: ListingItem[] = []
  const seen = new Set<string>()
  for (const chunk of eventsHtml.split('<article').slice(1)) {
    const titleM = chunk.match(/<h2 class="entry-title">\s*<a href="([^"]+\/events\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!titleM) continue
    const url = titleM[1]
    if (seen.has(url)) continue
    seen.add(url)
    const timeM = chunk.match(/<span class="ecp-event-time">([\s\S]*?)<\/span>\s*<\/p>/)
    const t = timeM ? parseEcpTime(timeM[1]) : { date: null, startClock: null, endClock: null }
    const imgM = chunk.match(/<div class="post-thumbnail">[\s\S]*?<img[^>]+src="([^"]+)"/)
    items.push({
      url,
      title: str(titleM[2].replace(/<[^>]+>/g, ' ')),
      date: t.date,
      startClock: t.startClock,
      endClock: t.endClock,
      image: imgM ? imgM[1] : null,
    })
  }
  return items
}

type LdAddress = { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string }
type LdImage = string | { url?: string } | Array<string | { url?: string }>
type LdOffer = { price?: string | number } | undefined
type LdOffers = LdOffer | LdOffer[]
type LdEvent = {
  '@type'?: string | string[]
  name?: string
  description?: string
  startDate?: string
  endDate?: string
  url?: string
  image?: LdImage
  location?: string | { name?: string; address?: LdAddress | string }
  offers?: LdOffers
}

function stripHtml(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return t || null
}

function imageUrl(img: LdImage | undefined): string | null {
  if (!img) return null
  if (typeof img === 'string') return img.trim() || null
  if (Array.isArray(img)) return imageUrl(img[0])
  if (typeof img === 'object') return str(img.url)
  return null
}

function addressOf(addr: LdAddress | string | undefined): string | null {
  if (!addr) return null
  if (typeof addr === 'string') return addr.trim() || null
  if (typeof addr !== 'object') return null
  const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(', ')
  return parts || null
}

function venueOf(loc: LdEvent['location']): { name: string | null; address: string | null } {
  if (typeof loc === 'string') return { name: str(loc), address: null }
  if (loc && typeof loc === 'object') return { name: str(loc.name), address: addressOf(loc.address) }
  return { name: null, address: null }
}

// Read pricing from schema.org offers. The site writes free-text prices
// ("$25.98", "Free", "Free with general admission ($9 - $12 ...)"), so: any
// dollar amounts present → paid with that min/max range; an explicit "free"
// with no dollar amounts → free; nothing usable → unknown (paid, no range).
export function parsePrice(offers: LdOffers): { is_free: boolean; price_min: number | null; price_max: number | null } {
  const list = (Array.isArray(offers) ? offers : [offers]).filter(Boolean) as Exclude<LdOffer, undefined>[]
  const priceStr = list.map(o => (o.price == null ? '' : String(o.price))).find(p => p.length > 0) ?? ''
  const nums = [...priceStr.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map(x => parseFloat(x[1]))
  if (nums.length > 0) return { is_free: false, price_min: Math.min(...nums), price_max: Math.max(...nums) }
  if (/\bfree\b/i.test(priceStr)) return { is_free: true, price_min: null, price_max: null }
  return { is_free: false, price_min: null, price_max: null }
}

function isEventNode(node: unknown): node is LdEvent {
  if (!node || typeof node !== 'object') return false
  const t = (node as Record<string, unknown>)['@type']
  return t === 'Event' || (Array.isArray(t) && (t as unknown[]).includes('Event'))
}

function findEvent(node: unknown): LdEvent | null {
  if (isEventNode(node)) return node
  if (Array.isArray(node)) {
    for (const n of node) {
      const e = findEvent(n)
      if (e) return e
    }
    return null
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      const e = findEvent(v)
      if (e) return e
    }
  }
  return null
}

// The first schema.org Event node in a detail page's JSON-LD, or null.
export function jsonLdEvent(html: string): LdEvent | null {
  const blocks = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) ?? []
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
    try {
      const ev = findEvent(JSON.parse(json))
      if (ev) return ev
    } catch {
      continue
    }
  }
  return null
}

function wallToIso(d: { y: number; m: number; d: number }, clock: { hh: number; mm: number }): string {
  return zonedToUtc(d.y, d.m, d.d, clock.hh, clock.mm, 0, TZ).toISOString()
}

// Combine a listing card with its (optional) detail-page JSON-LD into a
// RawEvent. The listing supplies the in-window date; the JSON-LD supplies venue,
// price, description and image (and a time-of-day fallback). Returns null when
// there's no usable date or title — everything else degrades gracefully so a
// detail-page fetch failure still yields a dated, titled event.
export function toRawEvent(item: ListingItem, ev: LdEvent | null, source: string): RawEvent | null {
  const date = parseLongDate(item.date)
  if (!date) return null
  const title = str(ev?.name) || item.title
  if (!title) return null

  // Time-of-day: listing clock, else the JSON-LD series' clock, else noon.
  const start = parseClockTime(item.startClock) ?? parseClockTime(ev?.startDate ?? null) ?? { hh: ALL_DAY_HOUR, mm: 0 }
  const start_time = wallToIso(date, start)

  const end = parseClockTime(item.endClock)
  let end_time: string | null = null
  if (end) {
    let endIso = wallToIso(date, end)
    // A listed end earlier than the start is a past-midnight finish (e.g.
    // 8pm–1am) — roll it to the next day.
    if (endIso <= start_time) endIso = wallToIso({ ...date, d: date.d + 1 }, end)
    end_time = endIso
  }

  const offsite = str(ev?.url) && /^https?:\/\//i.test(ev!.url!) ? ev!.url! : null
  const venue = venueOf(ev?.location)
  const { is_free, price_min, price_max } = parsePrice(ev?.offers)
  return {
    title,
    description: stripHtml(ev?.description),
    start_time,
    end_time,
    venue_name: venue.name,
    venue_address: venue.address,
    image_url: imageUrl(ev?.image) ?? item.image,
    ticket_url: offsite ?? item.url,
    source,
    source_id: item.url,
    is_free,
    price_min,
    price_max,
  }
}

// --- network passes ----------------------------------------------------------

function ymdInTz(date: Date): string {
  const { y, m, d } = partsInTz(date, TZ)
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

async function fetchText(url: string, init: RequestInit, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    if (!res.ok) return null
    return await res.text()
  } catch (e) {
    console.error(`austinmonthly fetch failed for ${url}:`, e)
    return null
  }
}

// One admin-ajax "load more" page. jQuery serializes the button's data-query
// object as nested form fields (query[start_date]=...), which is what the
// handler expects — a JSON string 500s.
async function fetchListingPage(startDate: string, endDate: string, paged: number): Promise<ListingItem[]> {
  const body = new URLSearchParams({
    action: 'austin_get_more_events',
    'query[offset]': '0',
    'query[categories]': '',
    'query[search]': '',
    'query[start_date]': startDate,
    'query[location]': '',
    'query[end_date]': endDate,
    'query[number]': '10',
    'query[date]': '',
    paged: String(paged),
  })
  const text = await fetchText(
    AJAX_URL,
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: 'https://www.austinmonthly.com/calendar/',
      },
      body: body.toString(),
    },
    LISTING_TIMEOUT_MS,
  )
  if (!text) return []
  try {
    const json = JSON.parse(text) as { data?: { events?: string } }
    const eventsHtml = json.data?.events ?? ''
    return eventsHtml.trim() ? parseListingItems(eventsHtml) : []
  } catch {
    return []
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export async function fetchAustinMonthlyEvents(
  url: string,
  source: string,
  since: Date,
  maxPages: number | null = null,
): Promise<RawEvent[]> {
  const startDate = ymdInTz(since)
  const endDate = ymdInTz(new Date(since.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000))
  const pageCap = maxPages && maxPages > 0 ? maxPages : DEFAULT_MAX_PAGES

  // `url` is kept for provenance/config even though the AJAX endpoint is fixed.
  void url
  const listing: ListingItem[] = []
  const seen = new Set<string>()
  for (let paged = 1; paged <= pageCap; paged++) {
    const items = await fetchListingPage(startDate, endDate, paged)
    if (items.length === 0) break // natural end signal
    let added = 0
    for (const it of items) {
      if (!seen.has(it.url)) {
        seen.add(it.url)
        listing.push(it)
        added++
      }
    }
    if (added === 0) break // defensive against a repeating tail
  }

  if (listing.length === 0) return []

  const events = await mapPool(listing, DETAIL_CONCURRENCY, async item => {
    const html = await fetchText(item.url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, DETAIL_TIMEOUT_MS)
    return toRawEvent(item, html ? jsonLdEvent(html) : null, source)
  })

  const out: RawEvent[] = []
  const byId = new Set<string>()
  for (const e of events) {
    if (e && !byId.has(e.source_id)) {
      byId.add(e.source_id)
      out.push(e)
    }
  }
  return out
}
