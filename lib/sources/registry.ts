import type { SourceParser, RawEvent, SourceContext, SourceRow } from './types'
import { fetchEventbriteEvents } from './eventbrite'
import { fetchIcalUrl } from './ical'
import { fetchTicketmasterEvents } from './ticketmaster'
import { fetchSeatGeekEvents } from './seatgeek'
import { fetchBlueskyEvents } from './social'
import { fetchYoutubeEvents } from './youtube'
import { fetchCrawlSource } from './crawler'
import { fetchFeed } from './rss'
import { extractEvents } from '@/lib/extractor'

const has = (v: string | undefined): boolean => !!v && v.length > 0
const hasGeminiKey = () => has(process.env.GEMINI_API_KEY)

// Stamp every event with the fetching SourceRow's authoritative `kind` (the
// DB's per-instance trust signal — see RawEvent.source_kind) so lib/dedup.ts's
// sourceTrust() can rank instance-named sources (e.g. 'crawl:mohawkaustin-com')
// correctly instead of only recognizing the handful of literal names in its
// static fallback map.
const withKind = (source: SourceRow, events: RawEvent[]): RawEvent[] =>
  events.map(e => ({ ...e, source_kind: source.kind }))

// Wrap a plain RawEvent[] producer as a non-skipping parser (only `crawl`
// content-hashes, so everyone else always reports skipped:false). `ctx` is
// available to every fetcher (geo-aware sources use it; the rest ignore it).
const simple = (
  available: () => boolean,
  fetch: (url: string | null, name: string, ctx: SourceContext) => Promise<RawEvent[]>
): SourceParser => ({
  available,
  fetch: async (source, ctx) => ({ events: withKind(source, await fetch(source.url, source.name, ctx)), skipped: false }),
})

// The parser registry: `SourceRow.parser` → mechanism. Instances (which
// feeds/venues/APIs) live in the `sources` table; this holds only the code that
// knows HOW to fetch each kind. Adding coverage of an existing kind is a DB
// INSERT; a genuinely new mechanism is one entry here.
export const PARSERS: Record<string, SourceParser> = {
  // Structured — no Gemini, always available.
  eventbrite: simple(() => true, () => fetchEventbriteEvents()),
  ical:       simple(() => true, (url, name) => fetchIcalUrl(url!, name)),

  // API-key gated, geo-parametrized by the source's city.
  ticketmaster: simple(() => has(process.env.TICKETMASTER_API_KEY), (_url, _name, ctx) => fetchTicketmasterEvents(ctx.city)),
  seatgeek:     simple(() => has(process.env.SEATGEEK_CLIENT_ID),   (_url, _name, ctx) => fetchSeatGeekEvents(ctx.city)),

  // Gemini-extracted free text.
  rss:     simple(hasGeminiKey, (url, name) => fetchFeed(url!, name, { limit: 20 }).then(extractEvents)),
  bluesky: simple(hasGeminiKey, () => fetchBlueskyEvents()),

  // Crawl: content-hash aware, returns its own skip flag.
  crawl: {
    available: hasGeminiKey,
    fetch: async (source) => {
      const { events, skipped } = await fetchCrawlSource(source)
      return { events: withKind(source, events), skipped }
    },
  },

  // YouTube needs both its API key and Gemini.
  youtube: simple(() => has(process.env.YOUTUBE_API_KEY) && hasGeminiKey(), () => fetchYoutubeEvents()),
}
