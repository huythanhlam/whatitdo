import type { SourceAdapter } from './types'
import { isLocal } from '@/lib/db'
import { fetchEventbriteEvents } from './eventbrite'
import { fetchIcalEvents } from './ical'
import { fetchTicketmasterEvents } from './ticketmaster'
import { fetchSeatGeekEvents } from './seatgeek'
import { fetchNewspaperEvents } from './newspapers'
import { fetchSocialEvents } from './social'
import { fetchYoutubeEvents } from './youtube'
import { fetchCrawlEvents } from './crawler'
import { fetchSeedEvents } from './seed'

const has = (v: string | undefined): boolean => !!v && v.length > 0

// The single source registry. Every source implements the same contract; the
// orchestrator (app/api/ingest/route.ts) iterates this list, so adding or
// gating a source is a one-line change here. `enabled()` is the honest answer
// to "can this source produce anything right now?" — a source that returns
// false is recorded as `skipped`, never mistaken for a dead/empty source.
//
// The existing parsers take no arguments yet; adapters accept the SourceContext
// (for the coming multi-city/incremental work) and ignore it for now.
export const SOURCES: SourceAdapter[] = [
  // Structured sources — no Gemini, always on.
  { name: 'eventbrite', kind: 'jsonld', enabled: () => true, fetch: () => fetchEventbriteEvents() },
  { name: 'ical',       kind: 'ical',   enabled: () => true, fetch: () => fetchIcalEvents() },

  // API-key gated.
  { name: 'ticketmaster', kind: 'api', enabled: () => has(process.env.TICKETMASTER_API_KEY), fetch: () => fetchTicketmasterEvents() },
  { name: 'seatgeek',     kind: 'api', enabled: () => has(process.env.SEATGEEK_CLIENT_ID),   fetch: () => fetchSeatGeekEvents() },

  // Gemini-extracted (free text → events); need GEMINI_API_KEY.
  { name: 'newspapers', kind: 'rss',   enabled: () => has(process.env.GEMINI_API_KEY), fetch: () => fetchNewspaperEvents() },
  { name: 'social',     kind: 'crawl', enabled: () => has(process.env.GEMINI_API_KEY), fetch: () => fetchSocialEvents() },
  { name: 'crawl',      kind: 'crawl', enabled: () => has(process.env.GEMINI_API_KEY), fetch: () => fetchCrawlEvents() },
  // YouTube needs both its API key and Gemini to extract event details.
  { name: 'youtube', kind: 'api', enabled: () => has(process.env.YOUTUBE_API_KEY) && has(process.env.GEMINI_API_KEY), fetch: () => fetchYoutubeEvents() },

  // Deterministic seed — dev only. In production the real sources fill the DB;
  // the seed exists so the zero-credential PGlite mode is never empty.
  { name: 'seed', kind: 'seed', enabled: () => isLocal(), fetch: () => fetchSeedEvents() },
]
