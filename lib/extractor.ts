import { GoogleGenAI } from '@google/genai'
import type { RawEvent } from './scrapers/types'
import type { FeedItem } from './scrapers/rss'

// Turns free-text feed items (newspaper articles, social posts) into structured
// events. Newspapers and social media don't publish machine-readable event
// data — they publish prose — so we use Gemini to decide whether each item
// describes a *specific, upcoming, dated* Austin event and, if so, to pull out
// the structured fields. Items that are general news, opinion, multi-event
// roundups, or undated are rejected. Without a GEMINI_API_KEY no reliable
// extraction is possible, so we contribute nothing rather than polluting the
// database with article headlines masquerading as events.

const apiKey = process.env.GEMINI_API_KEY
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

// Items per Gemini request. Smaller than the tagger's batch because each item
// carries more text and the model returns a richer object per item.
const BATCH_SIZE = 10

// Only keep events starting within this window (days) of "now". Guards against
// the model resolving a vague date to something absurd.
const MAX_FUTURE_DAYS = 270

export type ExtractedEvent = {
  is_event?: boolean
  title?: string | null
  description?: string | null // event-specific blurb (preferred over feed body)
  url?: string | null // event-specific link (preferred over the page/item link)
  start_time?: string | null // ISO 8601
  end_time?: string | null
  venue_name?: string | null
  venue_address?: string | null
  is_free?: boolean
  price_min?: number | null
  price_max?: number | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}

function httpOrNull(v: string | null | undefined): string | null {
  return v && /^https?:\/\//i.test(v) ? v : null
}

// Validate a model extraction against its source item and turn it into a
// RawEvent — or null if it isn't a usable, concretely-dated future event. Pure
// and model-free so it can be unit-tested.
export function buildEvent(
  item: FeedItem,
  ex: ExtractedEvent | null | undefined,
  nowIso: string,
  opts: { multiPerLink?: boolean } = {}
): RawEvent | null {
  if (!ex || ex.is_event !== true) return null

  const title = (ex.title ?? item.title ?? '').trim()
  if (title.length < 3) return null

  if (!ex.start_time) return null
  const start = new Date(ex.start_time)
  if (isNaN(start.getTime())) return null

  const now = new Date(nowIso)
  // Reject past events (the date the article was written is irrelevant) and
  // anything implausibly far out.
  if (start.getTime() < now.getTime() - 12 * 3600 * 1000) return null
  const maxFuture = now.getTime() + MAX_FUTURE_DAYS * 24 * 3600 * 1000
  if (start.getTime() > maxFuture) return null

  const end = ex.end_time ? new Date(ex.end_time) : null
  const end_time = end && !isNaN(end.getTime()) && end.getTime() >= start.getTime() ? end.toISOString() : null

  // Prefer an event-specific link/description when the model found one (aggregator
  // pages list per-event links); otherwise fall back to the source item.
  const link = httpOrNull(ex.url) || item.link
  const description = (ex.description?.trim() || item.content || null)?.slice(0, 600) || null

  // The event's link is the canonical reference + dedup key. A single article/post
  // maps to one event, so its URL alone is the stablest key. Aggregator pages list
  // many events under one URL, so there we append a title slug to keep them distinct.
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
  const source_id = opts.multiPerLink
    ? (link ? `${link}#${slug}` : `${item.source}-${slug}`)
    : (link || `${item.source}-${slug}`)

  return {
    title,
    description,
    start_time: start.toISOString(),
    end_time,
    venue_name: ex.venue_name?.trim() || null,
    venue_address: ex.venue_address?.trim() || null,
    image_url: item.image_url,
    ticket_url: link,
    source: item.source,
    source_id,
    is_free: ex.is_free === true,
    price_min: num(ex.price_min),
    price_max: num(ex.price_max),
  }
}

// Drop duplicates that share a (source, source_id) — the same article can show
// up across overlapping feeds (e.g. a subreddit and a cross-post).
export function dedupeEvents(events: RawEvent[]): RawEvent[] {
  const seen = new Set<string>()
  const out: RawEvent[] = []
  for (const e of events) {
    const key = `${e.source}::${e.source_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

function buildPrompt(items: FeedItem[], nowIso: string): string {
  const list = items
    .map((it, i) => {
      const published = it.published ? `   Published: ${it.published}\n` : ''
      return `${i}. Title: ${it.title}\n${published}   Text: ${(it.content ?? '').slice(0, 500)}`
    })
    .join('\n\n')

  return `You extract concrete, attendable EVENTS from Austin, Texas news articles and social media posts.

REFERENCE DATE (today): ${nowIso}

For EACH numbered item below, decide whether it announces ONE specific, upcoming, real-world event that a person could attend in or around Austin (a concert, festival, show, market, meetup, screening, game, exhibit opening, etc.).

Set is_event=false (and nothing else) when the item is:
- general news, opinion, analysis, or a profile with no specific event to attend
- a roundup/listicle covering MANY events (do not invent one)
- an event with no determinable calendar date, or only a vague one you cannot resolve
- an event whose date is in the PAST relative to the reference date
- recurring/ongoing with no specific upcoming occurrence

When is_event=true, also return:
- "title": a concise event name
- "start_time": ISO 8601 with timezone, resolving any relative dates against the reference date. Use America/Chicago (-05:00/-06:00) if no timezone is stated. If only a date is known, use 19:00 local.
- "end_time": ISO 8601 or null
- "venue_name": string or null
- "venue_address": string or null
- "is_free": true/false
- "price_min": number or null
- "price_max": number or null

Respond with ONLY a JSON object mapping each item number (as a string) to its object. No markdown, no commentary.
Example: {"0":{"is_event":false},"1":{"is_event":true,"title":"Mohawk Indie Night","start_time":"2026-07-04T20:00:00-05:00","end_time":null,"venue_name":"Mohawk","venue_address":null,"is_free":false,"price_min":15,"price_max":25}}

Items:
${list}

JSON:`
}

async function extractBatch(items: FeedItem[], nowIso: string): Promise<RawEvent[]> {
  try {
    const response = await ai!.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: buildPrompt(items, nowIso),
      config: { maxOutputTokens: 4096, temperature: 0 },
    })

    const text = (response.text ?? '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    const parsed = JSON.parse(text) as Record<string, ExtractedEvent>
    const out: RawEvent[] = []
    items.forEach((it, i) => {
      const ev = buildEvent(it, parsed[String(i)], nowIso)
      if (ev) out.push(ev)
    })
    return out
  } catch (e) {
    // A failed batch yields no events rather than guessing — keeps the DB clean.
    console.error('Event extraction batch failed:', e)
    return []
  }
}

// Extract structured events from a list of feed items. Returns [] when no
// Gemini key is configured (no reliable way to detect/date events without it).
export async function extractEvents(items: FeedItem[]): Promise<RawEvent[]> {
  if (items.length === 0) return []
  if (!ai) {
    console.warn('GEMINI_API_KEY not set — skipping newspaper/social event extraction')
    return []
  }

  const nowIso = new Date().toISOString()

  const batches: FeedItem[][] = []
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE))
  }

  const CONCURRENCY = 3
  let cursor = 0
  const collected: RawEvent[] = []
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor++]
      const events = await extractBatch(batch, nowIso)
      collected.push(...events)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker))

  return dedupeEvents(collected)
}

// ---------------------------------------------------------------------------
// Page extraction (aggregator / influencer / link-in-bio pages)
//
// Feed items map to at most ONE event each. A crawled page is different: an
// influencer's "things to do this weekend" post or an aggregator listing can
// contain MANY events. These functions pull every event off a single page.
// ---------------------------------------------------------------------------

export type CrawlPage = {
  source: string // e.g. 'crawl:365thingsaustin' or 'import'
  url: string
  title: string | null
  image_url: string | null
  text: string
}

// Build the per-event context (a synthetic FeedItem) that buildEvent consumes,
// then validate via the shared buildEvent. Exported for unit testing.
export function buildEventsFromPage(page: CrawlPage, extracted: ExtractedEvent[], nowIso: string): RawEvent[] {
  const out: RawEvent[] = []
  for (const ex of extracted) {
    const item: FeedItem = {
      source: page.source,
      title: ex.title ?? page.title ?? '',
      content: null, // description comes from the per-event blurb (ex.description)
      link: page.url, // fallback link; ex.url wins inside buildEvent when present
      published: null,
      image_url: page.image_url,
    }
    const ev = buildEvent(item, { ...ex, is_event: true }, nowIso, { multiPerLink: true })
    if (ev) out.push(ev)
  }
  return out
}

const PAGE_TEXT_CAP = 9000 // chars of page text sent to the model

async function extractPage(page: CrawlPage, nowIso: string): Promise<RawEvent[]> {
  const prompt = `You extract EVERY concrete, attendable event from the text of a single web page about Austin, Texas (an influencer post, an events roundup, or a link-in-bio page).

REFERENCE DATE (today): ${nowIso}
PAGE URL: ${page.url}
PAGE TITLE: ${page.title ?? '(none)'}

Return a JSON ARRAY with one object per SPECIFIC, UPCOMING, real-world event you can identify (a concert, festival, show, market, meetup, screening, game, etc.). If the page lists none, return [].

For each event include:
- "title": concise event name
- "description": one-sentence blurb (optional)
- "url": the event's own link if the page gives one, else null
- "start_time": ISO 8601 with timezone, resolving relative dates against the reference date. Use America/Chicago if no timezone is stated; if only a date is known use 19:00 local.
- "end_time": ISO 8601 or null
- "venue_name": string or null
- "venue_address": string or null
- "is_free": true/false
- "price_min": number or null
- "price_max": number or null

Rules:
- Only include events with a determinable date that is NOT in the past.
- Skip vague "follow us / link below" items and anything without a real date.
- Respond with ONLY the JSON array. No markdown, no commentary.

PAGE TEXT:
${page.text.slice(0, PAGE_TEXT_CAP)}

JSON array:`

  try {
    const response = await ai!.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { maxOutputTokens: 8192, temperature: 0 },
    })
    const text = (response.text ?? '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return buildEventsFromPage(page, parsed as ExtractedEvent[], nowIso)
  } catch (e) {
    console.error(`Page extraction failed for ${page.url}:`, e)
    return []
  }
}

// Extract events from one or more crawled pages. Returns [] with no Gemini key.
export async function extractEventsFromPages(pages: CrawlPage[]): Promise<RawEvent[]> {
  if (pages.length === 0) return []
  if (!ai) {
    console.warn('GEMINI_API_KEY not set — skipping page crawl extraction')
    return []
  }
  const nowIso = new Date().toISOString()

  const CONCURRENCY = 3
  let cursor = 0
  const collected: RawEvent[] = []
  async function worker() {
    while (cursor < pages.length) {
      const page = pages[cursor++]
      collected.push(...(await extractPage(page, nowIso)))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker))

  return dedupeEvents(collected)
}
