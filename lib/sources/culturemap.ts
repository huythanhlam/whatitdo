import * as cheerio from 'cheerio'
import type { RawEvent } from './types'
import { TZ, partsInTz, zonedToUtc, LOOKAHEAD_DAYS } from '@/lib/dateRanges'
import { mapPool } from '@/lib/gemini'

// austin.culturemap.com/events/ is a day-at-a-time listing (?tags=YYYYMMDD,
// defaulting to today when the param is absent) — confirmed real, static,
// server-rendered HTML (a plain `curl` returns the same event titles a
// browser does), so this is a structured scrape, no Gemini and no
// browser-render fallback needed. Each event <article> embeds its own
// <script type="application/json" id="post-context-..."> with a `post.tags`
// array mixing plain YYYYMMDD occurrence-date tags with matching
// `occurrenceYYYYMMDDHHmm` time tags — that's the only place an exact time
// lives (the human-visible "8:00 pm" text is rendered client-side from it).
// `url` is the events index URL, e.g. "https://austin.culturemap.com/events/".

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// One row per (event, day actually listed) rather than one row per
// recurring series — matches what the site itself shows on each day's page,
// and sidesteps guessing which of an event's many occurrence dates is its
// canonical start. Sweeps a rolling 2-month window (LOOKAHEAD_DAYS) so the
// feed stays current up to ~2 months out on every run; that's one HTTP request
// per day, so the days are fetched with bounded concurrency to stay well
// within the ingest route's maxDuration.
const DAYS_AHEAD = LOOKAHEAD_DAYS
const DAY_FETCH_CONCURRENCY = 8
const DEFAULT_HOUR = 19 // matches lib/extractor.ts's "date only -> 19:00 local" convention

type DayParts = { y: number; m: number; d: number }

function addDays(base: DayParts, days: number): DayParts {
  const dt = new Date(Date.UTC(base.y, base.m, base.d + days))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() }
}

function tagOf(p: DayParts): string {
  return `${p.y}${String(p.m + 1).padStart(2, '0')}${String(p.d).padStart(2, '0')}`
}

type PostContext = { post?: { id?: number | string; tags?: string[] } }

function timeForTag(tags: string[] | undefined, dateTag: string): { hh: number; mm: number } {
  const match = tags?.find(t => t.startsWith(`occurrence${dateTag}`))
  const digits = match?.slice(`occurrence${dateTag}`.length)
  if (digits && /^\d{4}$/.test(digits)) {
    return { hh: Number(digits.slice(0, 2)), mm: Number(digits.slice(2, 4)) }
  }
  return { hh: DEFAULT_HOUR, mm: 0 }
}

// Pure HTML -> events reduction for one day's page (no network), so it's
// unit-testable without mocking fetch.
export function eventsFromHtml(html: string, source: string, dateTag: string, day: DayParts): RawEvent[] {
  const $ = cheerio.load(html)
  const out: RawEvent[] = []
  const seen = new Set<string>()

  $('article.event-article').each((_, el) => {
    const $el = $(el)
    const anchor = $el.find('a.widget__headline-text').first()
    const title = anchor.text().trim()
    const ticket_url = anchor.attr('href')?.trim()
    if (!title || !ticket_url) return

    const scriptEl = $el.find('script[type="application/json"][id^="post-context-"]').first()
    let ctx: PostContext | null = null
    try {
      ctx = scriptEl.length ? (JSON.parse(scriptEl.text()) as PostContext) : null
    } catch {
      ctx = null
    }
    const idAttr = scriptEl.attr('id')?.replace('post-context-', '')
    const postId = ctx?.post?.id != null ? String(ctx.post.id) : idAttr
    if (!postId) return

    const source_id = `${postId}-${dateTag}`
    if (seen.has(source_id)) return
    seen.add(source_id)

    const venueName = $el.find('.event-location-name').first().text().trim()
    const addr1 = $el.find('.event-location-address-1').first().text().trim()
    const addr2 = $el.find('.event-location-address-2').first().text().trim()
    const venue_name = venueName || addr1 || null
    const venue_address = venueName ? [addr1, addr2].filter(Boolean).join(', ') || null : addr2 || null

    const image =
      $el.find('.widget__image').first().attr('data-runner-img-md') ||
      $el.find('.widget__image').first().attr('data-runner-img-hd') ||
      null

    const { hh, mm } = timeForTag(ctx?.post?.tags, dateTag)
    const start_time = zonedToUtc(day.y, day.m, day.d, hh, mm, 0, TZ).toISOString()

    out.push({
      title,
      description: null,
      start_time,
      end_time: null,
      venue_name,
      venue_address,
      image_url: image,
      ticket_url,
      source,
      source_id,
      is_free: false,
      price_min: null,
      price_max: null,
    })
  })

  return out
}

async function fetchDay(baseUrl: string, dateTag: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}?tags=${dateTag}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.text()
  } catch (e) {
    console.error(`CultureMap fetch failed for ${baseUrl}?tags=${dateTag}:`, e)
    return null
  }
}

export async function fetchCultureMapEvents(baseUrl: string, source: string): Promise<RawEvent[]> {
  const today = partsInTz(new Date(), TZ)
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i))

  // Fetch the whole window concurrently (bounded), preserving day order in the
  // results so the dedupe below keeps the earliest listing of a repeated event.
  const htmls = await mapPool(days, DAY_FETCH_CONCURRENCY, day => fetchDay(baseUrl, tagOf(day)))

  const out: RawEvent[] = []
  const seen = new Set<string>()
  days.forEach((day, i) => {
    const html = htmls[i]
    if (!html) return
    for (const raw of eventsFromHtml(html, source, tagOf(day), day)) {
      if (!seen.has(raw.source_id)) {
        seen.add(raw.source_id)
        out.push(raw)
      }
    }
  })

  return out
}
