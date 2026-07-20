import type { RawEvent } from './types'
import { eventsFromHtml, fetchHtml } from './jsonld-events'
import { nextPageUrl } from './pagination'
import { lookaheadHorizonMs } from '@/lib/dateRanges'

// 365thingsaustin.com runs "The Events Calendar" (Tribe), whose list view
// (/events/list/) embeds one schema.org Event JSON-LD per listing and paginates
// forward via <link rel="next" href="…/list/page/N/">. The default single page
// only reaches ~3 weeks out, so — unlike the generic 'events-jsonld' parser,
// which reads a single page — this follows the list's own pagination until it
// has covered the 2-month lookahead window (LOOKAHEAD_DAYS). It reuses the
// exact same JSON-LD extraction (`eventsFromHtml`) as 'events-jsonld'; only the
// page-walking is different. `url` is the list-view URL.

const MAX_PAGES = 8

// Two "featured" events repeat in every page's JSON-LD, so dedupe by source_id
// across pages and, for the stop decision, look only at events new to this page
// (the repeated featured ones are near-term and would otherwise pin the
// earliest-start forever, defeating the horizon check).
type PageStep = { added: RawEvent[]; reachedHorizon: boolean }

function mergePage(html: string, source: string, fallbackUrl: string, seen: Set<string>, horizonMs: number): PageStep {
  const added: RawEvent[] = []
  for (const ev of eventsFromHtml(html, source, fallbackUrl)) {
    if (seen.has(ev.source_id)) continue
    seen.add(ev.source_id)
    added.push(ev)
  }
  // We've paged past the window once the earliest event *new to this page*
  // already starts beyond the horizon — everything further is later still.
  const earliestNew = added.reduce((min, e) => Math.min(min, Date.parse(e.start_time)), Infinity)
  return { added, reachedHorizon: earliestNew > horizonMs }
}

// Page-walking loop with an injectable fetcher, so the pagination/stop logic is
// unit-testable without real network.
export async function collectTribeEvents(
  startUrl: string,
  source: string,
  fetchPage: (url: string) => Promise<string | null>,
  horizonMs: number
): Promise<RawEvent[]> {
  const out: RawEvent[] = []
  const seen = new Set<string>()
  let url: string | null = startUrl

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const html: string | null = await fetchPage(url)
    if (!html) break
    const { added, reachedHorizon } = mergePage(html, source, url, seen, horizonMs)
    out.push(...added)
    // Stop once we've covered the window, or a page adds nothing new (no
    // forward progress — avoids looping on a repeated final page).
    if (reachedHorizon || added.length === 0) break
    url = nextPageUrl(html, url)
  }

  return out
}

export async function fetchTribeEvents(baseUrl: string, source: string): Promise<RawEvent[]> {
  return collectTribeEvents(baseUrl, source, url => fetchHtml(url, 20000), lookaheadHorizonMs())
}
