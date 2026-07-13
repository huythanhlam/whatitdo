import type { RawEvent } from './types'

// Partiful's /explore/<region> pages are Next.js, server-rendered: every event
// card's full data (title, description, ISO start/end, address, image) is
// embedded in the <script id="__NEXT_DATA__"> payload, not just the DOM text
// — so a plain fetch + JSON parse gets everything without Gemini. The exact
// nesting (trendingSection.items[].event, sections[].items[].event,
// feedItems[]...) isn't a stable contract, so instead of hard-coding a path we
// walk the whole payload and pick out anything event-shaped.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

type PartifulEvent = {
  id: string
  title: string
  description?: string
  startDate?: string
  endDate?: string
  isPublic?: boolean
  locationInfo?: {
    mapsInfo?: { name?: string; addressLines?: string[] }
    displayAddressLines?: string[]
  }
  image?: { upload?: { path?: string } }
}

function isPartifulEvent(v: unknown): v is PartifulEvent {
  const o = v as Record<string, unknown>
  return (
    !!o &&
    typeof o === 'object' &&
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.startDate === 'string'
  )
}

// Walk the whole __NEXT_DATA__ tree collecting any event-shaped object,
// deduped by id — robust to which carousel/section a given event surfaced in.
function collectEvents(node: unknown, out: Map<string, PartifulEvent>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectEvents(n, out)
    return
  }
  if (!node || typeof node !== 'object') return
  if (isPartifulEvent(node) && !out.has(node.id)) out.set(node.id, node)
  for (const v of Object.values(node as Record<string, unknown>)) collectEvents(v, out)
}

function addressOf(loc: PartifulEvent['locationInfo']): string | null {
  const lines = loc?.mapsInfo?.addressLines ?? loc?.displayAddressLines
  return lines && lines.length > 0 ? lines.join(', ') : null
}

// __NEXT_DATA__'s event.image.url/upload.url point straight at a Firebase
// Storage object with no download token — that URL 403s (verified live)
// rather than serving the image. Partiful's own frontend never renders that
// URL either: it serves images through their imgix CDN at image.upload.path,
// which is publicly readable. Build that same URL instead.
function imageUrlOf(image: PartifulEvent['image']): string | null {
  const path = image?.upload?.path
  return path ? `https://partiful.imgix.net/${path}` : null
}

function toIso(raw: string | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function toRawEvent(ev: PartifulEvent, source: string): RawEvent | null {
  const start_time = toIso(ev.startDate)
  if (!start_time || ev.isPublic === false) return null
  return {
    title: ev.title,
    description: ev.description?.trim() || null,
    start_time,
    end_time: toIso(ev.endDate),
    venue_name: ev.locationInfo?.mapsInfo?.name ?? null,
    venue_address: addressOf(ev.locationInfo),
    image_url: imageUrlOf(ev.image),
    ticket_url: `https://partiful.com/e/${ev.id}`,
    source,
    source_id: ev.id,
    is_free: false,
    price_min: null,
    price_max: null,
  }
}

// Pure __NEXT_DATA__ JSON -> events reduction (no network), so it's
// unit-testable without mocking fetch.
export function eventsFromNextData(data: unknown, source: string): RawEvent[] {
  const found = new Map<string, PartifulEvent>()
  collectEvents((data as { props?: { pageProps?: unknown } })?.props?.pageProps, found)

  const out: RawEvent[] = []
  for (const ev of found.values()) {
    const raw = toRawEvent(ev, source)
    if (raw) out.push(raw)
  }
  return out
}

export async function fetchPartifulEvents(url: string, source: string): Promise<RawEvent[]> {
  let html: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return []
    html = await res.text()
  } catch (e) {
    console.error(`Partiful fetch failed for ${url}:`, e)
    return []
  }

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return []

  let data: unknown
  try {
    data = JSON.parse(m[1])
  } catch (e) {
    console.error(`Partiful __NEXT_DATA__ parse failed for ${url}:`, e)
    return []
  }

  return eventsFromNextData(data, source)
}
