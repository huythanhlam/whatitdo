import type { SourceParser, RawEvent } from './types'
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

// Wrap a plain RawEvent[] producer as a non-skipping parser (only `crawl`
// content-hashes, so everyone else always reports skipped:false).
const simple = (
  available: () => boolean,
  fetch: (url: string | null, name: string) => Promise<RawEvent[]>
): SourceParser => ({
  available,
  fetch: async (source) => ({ events: await fetch(source.url, source.name), skipped: false }),
})

// The parser registry: `SourceRow.parser` → mechanism. Instances (which
// feeds/venues/APIs) live in the `sources` table; this holds only the code that
// knows HOW to fetch each kind. Adding coverage of an existing kind is a DB
// INSERT; a genuinely new mechanism is one entry here.
export const PARSERS: Record<string, SourceParser> = {
  // Structured — no Gemini, always available.
  eventbrite: simple(() => true, () => fetchEventbriteEvents()),
  ical:       simple(() => true, (url, name) => fetchIcalUrl(url!, name)),

  // API-key gated.
  ticketmaster: simple(() => has(process.env.TICKETMASTER_API_KEY), () => fetchTicketmasterEvents()),
  seatgeek:     simple(() => has(process.env.SEATGEEK_CLIENT_ID),   () => fetchSeatGeekEvents()),

  // Gemini-extracted free text.
  rss:     simple(hasGeminiKey, (url, name) => fetchFeed(url!, name, { limit: 20 }).then(extractEvents)),
  bluesky: simple(hasGeminiKey, () => fetchBlueskyEvents()),

  // Crawl: content-hash aware, returns its own skip flag.
  crawl: { available: hasGeminiKey, fetch: (source) => fetchCrawlSource(source) },

  // YouTube needs both its API key and Gemini.
  youtube: simple(() => has(process.env.YOUTUBE_API_KEY) && hasGeminiKey(), () => fetchYoutubeEvents()),
}
