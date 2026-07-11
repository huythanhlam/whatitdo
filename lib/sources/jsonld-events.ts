import type { RawEvent } from './types'

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

const MAX_DETAIL_PAGES = 30

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
// be followed up one level.
function collect(node: unknown, events: LdEvent[], urls: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, events, urls)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  const type = obj['@type']
  if (type === 'Event' || (Array.isArray(type) && type.includes('Event'))) events.push(obj as LdEvent)

  if (obj['@graph']) collect(obj['@graph'], events, urls)

  const list = obj['itemListElement']
  if (Array.isArray(list)) {
    for (const entry of list) {
      const e = entry as Record<string, unknown>
      if (e?.item) collect(e.item, events, urls)
      else if (typeof e?.url === 'string') urls.add(e.url)
    }
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

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
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

  // No events on the index page itself — follow its ItemList of detail-page
  // URLs (capped, so a 100+ item index can't blow the run's time budget).
  const { urls } = parseBlocks(html)
  if (urls.size === 0) return []

  const detailUrls = [...urls].slice(0, MAX_DETAIL_PAGES)
  const pages = await Promise.all(detailUrls.map(u => fetchHtml(u, 15000)))
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
