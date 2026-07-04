import { fetchFeeds } from './rss'
import { extractEvents } from '@/lib/extractor'
import type { RawEvent } from './types'

// Local Austin newspapers / news outlets that publish RSS. These are article
// feeds, not event calendars, so each item is run through the LLM extractor
// (lib/extractor) which keeps only items announcing a specific upcoming event.
// Verified reachable + valid XML as of build time; unreachable feeds simply
// contribute nothing (fetchFeeds isolates failures per feed).
const NEWSPAPER_FEEDS: { url: string; source: string }[] = [
  { url: 'https://www.kut.org/tags/events.rss', source: 'newspaper:kut' },
  { url: 'https://www.austinmonitor.com/feed/', source: 'newspaper:austin-monitor' },
  { url: 'https://thedailytexan.com/feed/', source: 'newspaper:daily-texan' },
  { url: 'https://austin.towers.net/feed/', source: 'newspaper:towers' },
  { url: 'https://www.kvue.com/feeds/syndication/rss/news/local', source: 'newspaper:kvue' },
  { url: 'https://austin.eater.com/rss/index.xml', source: 'newspaper:eater-austin' },
  { url: 'https://www.kxan.com/feed/', source: 'newspaper:kxan' },
  { url: 'https://communityimpact.com/rss/', source: 'newspaper:community-impact' },
  { url: 'https://www.fox7austin.com/rss/category/local-news', source: 'newspaper:fox7-austin' },
]

// Allow operators to add feeds without a code change:
// NEWSPAPER_FEEDS="https://site/feed|newspaper:my-source,https://other/rss|newspaper:other"
function configuredFeeds(): { url: string; source: string }[] {
  const raw = process.env.NEWSPAPER_FEEDS
  if (!raw) return NEWSPAPER_FEEDS
  const extra = raw
    .split(',')
    .map(pair => pair.trim())
    .filter(Boolean)
    .map(pair => {
      const [url, source] = pair.split('|').map(s => s.trim())
      return { url, source: source || `newspaper:${new URL(url).hostname}` }
    })
    .filter(f => f.url && /^https?:\/\//i.test(f.url))
  return [...NEWSPAPER_FEEDS, ...extra]
}

export async function fetchNewspaperEvents(): Promise<RawEvent[]> {
  const items = await fetchFeeds(configuredFeeds(), { limit: 20 })
  if (items.length === 0) return []
  return extractEvents(items)
}
