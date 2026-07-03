import { extractEvents } from '@/lib/extractor'
import type { FeedItem } from './rss'
import type { RawEvent } from './types'

// YouTube Data API v3 — the one item from the "free social APIs" list with a
// real, free, keyword-searchable endpoint. Austin venues, promoters, and local
// media post event announcements and livestream premieres here; titles and
// descriptions are free text, so results funnel through the LLM extractor
// (lib/extractor) which keeps only specific, upcoming, dated events.
//
// Free tier: 10,000 quota units/day; each search.list call costs 100 units, so
// the handful of queries below are comfortably free. Returns [] with no key.

// Searches tuned for in-person Austin happenings (not generic vlogs).
const QUERIES = [
  'Austin TX events this weekend',
  'Austin live music show',
  'things to do in Austin',
  'Austin festival',
]

// How many recent results to request per query.
const PER_QUERY = 15

type YtThumbnails = { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } }
type YtSearchItem = {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelTitle?: string
    thumbnails?: YtThumbnails
  }
}

function bestThumb(t: YtThumbnails | undefined): string | null {
  return t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? null
}

// Pure mapping of a YouTube search response into FeedItems — exported so it can
// be unit-tested against a fixture without a network call or API key.
export function mapYoutubeItems(items: YtSearchItem[]): FeedItem[] {
  const out: FeedItem[] = []
  for (const it of items) {
    const videoId = it.id?.videoId
    const title = it.snippet?.title?.trim()
    if (!videoId || !title) continue
    const desc = it.snippet?.description?.trim() || null
    out.push({
      source: 'youtube',
      title,
      // Channel name adds locality/venue context for the extractor.
      content: [it.snippet?.channelTitle, desc].filter(Boolean).join(' — ') || null,
      link: `https://www.youtube.com/watch?v=${videoId}`,
      published: it.snippet?.publishedAt ?? null,
      image_url: bestThumb(it.snippet?.thumbnails),
    })
  }
  return out
}

async function searchOne(query: string, key: string, publishedAfter: string): Promise<FeedItem[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', query)
  url.searchParams.set('type', 'video')
  url.searchParams.set('order', 'date')
  url.searchParams.set('regionCode', 'US')
  url.searchParams.set('relevanceLanguage', 'en')
  url.searchParams.set('maxResults', String(PER_QUERY))
  url.searchParams.set('publishedAfter', publishedAfter)
  url.searchParams.set('key', key)

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`YouTube search "${query}" returned HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { items?: YtSearchItem[] }
    return mapYoutubeItems(data.items ?? [])
  } catch (e) {
    console.error(`YouTube search "${query}" failed:`, e)
    return []
  }
}

export async function fetchYoutubeEvents(): Promise<RawEvent[]> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) {
    console.warn('YOUTUBE_API_KEY not set — skipping YouTube')
    return []
  }

  // Only consider videos posted in the last 30 days — older uploads are very
  // unlikely to announce a still-upcoming event.
  const publishedAfter = new Date(Date.now() - 30 * 86400000).toISOString()

  const settled = await Promise.allSettled(QUERIES.map(q => searchOne(q, key, publishedAfter)))
  const items = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []))
  if (items.length === 0) return []
  return extractEvents(items)
}
