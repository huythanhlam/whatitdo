import type { RawEvent } from './types'
import { mapPool } from '@/lib/gemini'
import { nextPageUrl } from './pagination'

// Generic schema.org Event scraper for pages that publish structured data
// directly — no Gemini required, so it's free and exact where it applies.
// Two shapes are handled: (1) Event nodes embedded right on the page (a
// <script type="application/ld+json"> per event, or an @graph/ItemList
// containing them — e.g. thelongcenter.org, 365thingsaustin.com), and (2) an
// ItemList of plain event-page URLs with the actual Event JSON-LD living on
// each detail page (e.g. austintexas.gov's Drupal "events" index). Falls back
// to [] on any failure so one bad/changed page can't sink the run.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Two-level (ItemList index → detail pages) crawl bounds. The index paginates
// (?page=N) and is NOT date-sorted, so far-future events can sit on any page;
// to reach ~2 months out we walk the whole index (austintexas.gov's is ~14
// pages / ~140 events, live-verified), following rel="next" until it runs out.
// The caps are generous safety bounds (fetched with bounded concurrency) so a
// much larger index still can't blow the ingest route's time budget.
const MAX_INDEX_PAGES = 20
const MAX_DETAIL_PAGES = 250
const DETAIL_FETCH_CONCURRENCY = 10

type LdAddress = { streetAddress?: string; addressLocality?: string; addressRegion?: string }
type LdImage = string | { url?: string } | Array<string | { url?: string }>
type LdEvent = {
  '@type'?: string | string[]
  name?: string
  description?: string
  startDate?: string
  endDate?: string
  url?: string
  image?: LdImage
  location?: { name?: string; address?: LdAddress | string }
}

function stripHtml(s: string | undefined | null): string | null {
  if (!s) return null
  const text = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || null
}

function imageUrl(img: LdImage | undefined): string | null {
  if (!img) return null
  if (typeof img === 'string') return img
  if (Array.isArray(img)) return imageUrl(img[0])
  return img.url ?? null
}

function addressOf(addr: LdAddress | string | undefined): string | null {
  if (!addr) return null
  if (typeof addr === 'string') return addr
  const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ')
  return parts || null
}

// Some sites emit loosely-padded ISO-ish datetimes JS's Date can't parse, e.g.
// thelongcenter.org's "2026-7-16T20:00-5:00" (single-digit month and tz
// offset, no seconds) instead of "2026-07-16T20:00:00-05:00". Try native
// parsing first; on failure, zero-pad the pieces and retry once.
export function toIso(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  const native = new Date(s)
  if (!isNaN(native.getTime())) return native.toISOString()

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})(?::(\d{2}))?([+-])(\d{1,2}):?(\d{2})?$/)
  if (!m) return null
  const [, y, mo, da, h, mi, se, sign, tzh, tzm] = m
  const pad = (v: string) => v.padStart(2, '0')
  const normalized = `${y}-${pad(mo)}-${pad(da)}T${pad(h)}:${mi}:${se ?? '00'}${sign}${pad(tzh)}:${tzm ?? '00'}`
  const fixed = new Date(normalized)
  return isNaN(fixed.getTime()) ? null : fixed.toISOString()
}

// Recursively collect every schema.org Event node from a parsed JSON-LD value,
// and separately every bare item-list URL (position/url pairs with no
// embedded `item`) so pages that only link out to per-event detail pages can
// be followed up one level. Walks every object property generically (not just
// the standard @graph/itemListElement wrappers) — e.g. capcitycomedy.com nests
// its full Event array under a non-standard Place.Events key, and there's no
// reason to special-case every such quirk when a generic walk finds it too.
function collect(node: unknown, events: LdEvent[], urls: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, events, urls)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  const type = obj['@type']
  if (type === 'Event' || (Array.isArray(type) && type.includes('Event'))) {
    events.push(obj as LdEvent)
    return
  }

  for (const [key, v] of Object.entries(obj)) {
    // itemListElement entries need their own handling (a bare {position,url}
    // with no embedded `item` carries a URL, not a node) — handle it here and
    // skip it in the generic walk below so a ListItem's Event doesn't get
    // collected twice (once via `.item`, once via the generic recursion into
    // the same array's objects).
    if (key === 'itemListElement' && Array.isArray(v)) {
      for (const entry of v) {
        const e = entry as Record<string, unknown>
        if (e?.item) collect(e.item, events, urls)
        else if (typeof e?.url === 'string') urls.add(e.url)
      }
      continue
    }
    collect(v, events, urls)
  }
}

function parseBlocks(html: string): { events: LdEvent[]; urls: Set<string> } {
  const events: LdEvent[] = []
  const urls = new Set<string>()
  const blocks = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) ?? []
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
    try {
      collect(JSON.parse(json), events, urls)
    } catch {
      continue
    }
  }
  return { events, urls }
}

function toRawEvent(ev: LdEvent, source: string, fallbackUrl: string): RawEvent | null {
  const start_time = toIso(ev.startDate)
  if (!start_time || !ev.name) return null
  const url = ev.url ?? fallbackUrl
  return {
    title: ev.name,
    description: stripHtml(ev.description),
    start_time,
    end_time: toIso(ev.endDate),
    venue_name: ev.location?.name ?? null,
    venue_address: addressOf(ev.location?.address),
    image_url: imageUrl(ev.image),
    ticket_url: url,
    source,
    source_id: url,
    is_free: false,
    price_min: null,
    price_max: null,
  }
}

// Pure HTML -> events reduction for the direct-embed case (no network), so
// it's unit-testable without mocking fetch.
export function eventsFromHtml(html: string, source: string, fallbackUrl: string): RawEvent[] {
  const { events } = parseBlocks(html)
  const out: RawEvent[] = []
  const seen = new Set<string>()
  for (const ev of events) {
    const raw = toRawEvent(ev, source, fallbackUrl)
    if (raw && !seen.has(raw.source_id)) {
      seen.add(raw.source_id)
      out.push(raw)
    }
  }
  return out
}

export async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.text()
  } catch (e) {
    console.error(`JSON-LD fetch failed for ${url}:`, e)
    return null
  }
}

export async function fetchJsonLdEvents(url: string, source: string): Promise<RawEvent[]> {
  const html = await fetchHtml(url, 20000)
  if (!html) return []

  const out = eventsFromHtml(html, source, url)
  if (out.length > 0) return out

  // No events on the index page itself — the two-level case (e.g.
  // austintexas.gov's Drupal events index): a paginated ItemList of detail-page
  // URLs (?page=N, advertised via rel="next"), with the actual Event JSON-LD on
  // each detail page. Walk the index's own pagination to gather detail URLs
  // across pages. The index is not date-sorted and exposes no dates until the
  // detail page, so the 2-month lookahead is covered by breadth (more index
  // pages = more events, including the near-2-month ones), bounded by the caps.
  const detailUrls = new Set<string>()
  let indexUrl: string | null = url
  for (let page = 0; page < MAX_INDEX_PAGES && indexUrl && detailUrls.size < MAX_DETAIL_PAGES; page++) {
    const indexHtml: string | null = page === 0 ? html : await fetchHtml(indexUrl, 20000)
    if (!indexHtml) break
    for (const u of parseBlocks(indexHtml).urls) detailUrls.add(u)
    indexUrl = nextPageUrl(indexHtml, indexUrl)
  }
  if (detailUrls.size === 0) return out

  const capped = [...detailUrls].slice(0, MAX_DETAIL_PAGES)
  const pages = await mapPool(capped, DETAIL_FETCH_CONCURRENCY, u => fetchHtml(u, 15000))
  const seen = new Set<string>()
  for (const detailHtml of pages) {
    if (!detailHtml) continue
    for (const raw of eventsFromHtml(detailHtml, source, url)) {
      if (!seen.has(raw.source_id)) {
        seen.add(raw.source_id)
        out.push(raw)
      }
    }
  }
  return out
}
