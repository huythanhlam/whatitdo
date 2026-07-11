import type { RawEvent } from './types'

// Many US destination-marketing-org sites (e.g. austintexas.org) run on the
// Simpleview CMS, whose events widget calls a public, unauthenticated JSON
// REST API to populate itself — no Gemini, no browser rendering, just two
// plain HTTP GETs. Found by inspecting the widget's own network calls in a
// real browser session (not by defeating any bot-protection — this endpoint
// has none; it's the site's own public data call). `baseUrl` is the site
// origin, e.g. "https://www.austintexas.org".

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const PAGE_SIZE = 100
const MAX_EVENTS = 500

type SimpleviewEvent = {
  recid?: string
  id?: string
  title?: string
  startDate?: string
  endDate?: string
  location?: string
  absoluteUrl?: string
  media_raw?: Array<{ mediaurl?: string }>
}

async function fetchToken(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/plugins/core/get_simple_token/`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const token = (await res.text()).trim()
    return token || null
  } catch (e) {
    console.error(`Simpleview token fetch failed for ${baseUrl}:`, e)
    return null
  }
}

function toIso(raw: string | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function toRawEvent(ev: SimpleviewEvent, source: string): RawEvent | null {
  const start_time = toIso(ev.startDate)
  const source_id = ev.recid ?? ev.id
  if (!start_time || !ev.title || !ev.absoluteUrl || !source_id) return null
  return {
    title: ev.title,
    description: null,
    start_time,
    end_time: toIso(ev.endDate),
    venue_name: ev.location ?? null,
    venue_address: null,
    image_url: ev.media_raw?.[0]?.mediaurl ?? null,
    ticket_url: ev.absoluteUrl,
    source,
    source_id,
    is_free: false,
    price_min: null,
    price_max: null,
  }
}

// Pure docs -> events reduction (no network), so it's unit-testable without
// mocking fetch.
export function eventsFromDocs(docs: SimpleviewEvent[], source: string): RawEvent[] {
  const out: RawEvent[] = []
  const seen = new Set<string>()
  for (const ev of docs) {
    const raw = toRawEvent(ev, source)
    if (raw && !seen.has(raw.source_id)) {
      seen.add(raw.source_id)
      out.push(raw)
    }
  }
  return out
}

async function fetchPage(baseUrl: string, token: string, skip: number): Promise<SimpleviewEvent[]> {
  const query = {
    filter: { active: true },
    options: {
      limit: PAGE_SIZE,
      skip,
      count: true,
      castDocs: false,
      fields: { _id: 1, title: 1, startDate: 1, endDate: 1, location: 1, media_raw: 1, recid: 1, absoluteUrl: 1 },
      sort: { date: 1 },
    },
  }
  const url = `${baseUrl}/includes/rest_v2/plugins_events_events_by_date/find//?json=${encodeURIComponent(JSON.stringify(query))}&token=${token}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { docs?: { docs?: SimpleviewEvent[] } }
    return data.docs?.docs ?? []
  } catch (e) {
    console.error(`Simpleview events fetch failed for ${baseUrl}:`, e)
    return []
  }
}

export async function fetchSimpleviewEvents(baseUrl: string, source: string): Promise<RawEvent[]> {
  const token = await fetchToken(baseUrl)
  if (!token) return []

  const out: RawEvent[] = []
  const seen = new Set<string>()

  for (let skip = 0; skip < MAX_EVENTS; skip += PAGE_SIZE) {
    const batch = await fetchPage(baseUrl, token, skip)
    if (batch.length === 0) break
    for (const raw of eventsFromDocs(batch, source)) {
      if (!seen.has(raw.source_id)) {
        seen.add(raw.source_id)
        out.push(raw)
      }
    }
    if (batch.length < PAGE_SIZE) break
  }

  return out
}
