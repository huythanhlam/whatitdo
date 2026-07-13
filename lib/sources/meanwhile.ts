import * as cheerio from 'cheerio'
import type { RawEvent } from './types'
import { TZ, zonedToUtc } from '@/lib/dateRanges'

// meanwhilebeer.com/events was live-verified (plain `curl`, no browser/JS) to
// be a Webflow CMS collection list, statically server-rendered — each item's
// own event-specific flyer image is baked right into its `background-image`
// style, so this structured scrape (no Gemini) captures per-event art the
// generic Gemini `crawl` parser it replaces never saw. The listing paginates
// via Webflow's own "Next" link (`?<collection-hash>_page=N`); rather than
// hardcode that hash (random per collection, would break on any redesign),
// this follows the page's own rendered Next-page href until it's exhausted,
// a page yields no events, or MAX_PAGES is hit — live-verified at 4 pages /
// ~80 events, vs. the single content-hashed page the old crawl parser saw.
//
// Meanwhile is a single taproom (not an aggregator), so venue name/address
// are fixed rather than scraped per event (address live-verified in the
// site's own footer). The listing has no per-event description field (only
// on each event's own detail page, which this intentionally doesn't fetch —
// 80 extra requests per run for a field nothing here surfaces yet); `null`
// here matches Meetup/Luma/Partiful's "when the source doesn't have it,
// don't invent it" convention.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const ORIGIN = 'https://www.meanwhilebeer.com'
const VENUE_NAME = 'Meanwhile Brewing Co.'
const VENUE_ADDRESS = '3901 Promontory Point Dr, Austin, TX 78744'

// Safety cap on Next-link following, mirroring luma.ts/paginated-crawl.ts's
// max_pages guard — the live site is 4 pages, this just bounds the worst case.
const MAX_PAGES = 20

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

// "July 12, 2026" -> {y, m (0-indexed), d}, or null if unparseable.
export function parseLongDate(s: string): { y: number; m: number; d: number } | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(s.trim())
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  if (month === undefined) return null
  return { y: Number(m[3]), m: month, d: Number(m[2]) }
}

// "9:00 am" / "7:00 PM" -> 24h {hh, mm}, or null if unparseable.
export function parseClockTime(s: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(s.trim())
  if (!m) return null
  let hh = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'pm') hh += 12
  return { hh, mm: Number(m[2]) }
}

function imageFromStyle(style: string | undefined): string | null {
  if (!style) return null
  const m = /url\((['"]?)(.*?)\1\)/.exec(style)
  return m ? m[2] : null
}

// Pure HTML -> events reduction for one listing page (no network), so it's
// unit-testable without mocking fetch.
export function eventsFromHtml(html: string, source: string): RawEvent[] {
  const $ = cheerio.load(html)
  const out: RawEvent[] = []

  $('.event-calendar.w-dyn-list .w-dyn-item').each((_, el) => {
    const $el = $(el)

    const left = $el.find('a.event-left').first()
    const detailHref = left.attr('href')?.trim()
    const title = $el.find('.beer-name.events').first().text().trim()
    if (!title || !detailHref) return

    const detailUrl = new URL(detailHref, ORIGIN).toString()

    const date = parseLongDate($el.find('.beer-style.events.left').first().text())
    if (!date) return

    const time = parseClockTime($el.find('.events-sub-info > .beer-style.events').first().text())
    const start_time = zonedToUtc(date.y, date.m, date.d, time?.hh ?? 19, time?.mm ?? 0, 0, TZ).toISOString()

    const image_url = imageFromStyle($el.find('.hover-image').first().attr('style'))

    const right = $el.find('a.event-right').first()
    const rightHref = right.attr('href')?.trim()
    const ticket_url = rightHref && rightHref !== '#' ? rightHref : detailUrl

    // Webflow renders both a paid- and a free-container per item and hides
    // whichever doesn't apply via a `w-condition-invisible` class bound to
    // the CMS's own "is free" field — reading which one is visible is more
    // reliable than parsing the human "Free Event" label text.
    const freeEl = right.find('.free-container').first()
    const is_free = freeEl.length > 0 && !freeEl.hasClass('w-condition-invisible')

    out.push({
      title,
      description: null,
      start_time,
      end_time: null,
      venue_name: VENUE_NAME,
      venue_address: VENUE_ADDRESS,
      image_url,
      ticket_url,
      source,
      source_id: detailUrl,
      is_free,
      price_min: null,
      price_max: null,
    })
  })

  return out
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.text()
  } catch (e) {
    console.error(`Meanwhile fetch failed for ${url}:`, e)
    return null
  }
}

// Reads the page's own rendered "Next" pagination link rather than
// hardcoding Webflow's per-collection `?<hash>_page=N` param.
function nextPageUrl(html: string, currentUrl: string): string | null {
  const $ = cheerio.load(html)
  const href = $('.w-pagination-next').first().attr('href')?.trim()
  if (!href) return null
  try {
    return new URL(href, currentUrl).toString()
  } catch {
    return null
  }
}

export async function fetchMeanwhileEvents(url: string, source: string): Promise<RawEvent[]> {
  const out: RawEvent[] = []
  const seen = new Set<string>()
  let pageUrl: string | null = url

  for (let page = 0; pageUrl && page < MAX_PAGES; page++) {
    const html: string | null = await fetchHtml(pageUrl)
    if (!html) break

    const events = eventsFromHtml(html, source)
    if (events.length === 0) break
    for (const ev of events) {
      if (!seen.has(ev.source_id)) {
        seen.add(ev.source_id)
        out.push(ev)
      }
    }

    pageUrl = nextPageUrl(html, pageUrl)
  }

  return out
}
