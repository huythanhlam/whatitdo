import { fetchFeeds, type FeedItem } from './rss'
import { extractEvents } from '@/lib/extractor'
import type { RawEvent } from './types'

// Social media feeds. Like newspapers, posts are free text, so everything funnels
// through the LLM extractor which keeps only specific, upcoming, dated events.
//
// Reddit exposes per-subreddit Atom feeds at /<sub>/.rss (the JSON API blocks
// datacenter IPs, but .rss is served through a CDN that does not). Bluesky's
// public AppView (public.api.bsky.app) needs no auth.

// Subreddits whose posts are predominantly Austin happenings.
const REDDIT_FEEDS: { url: string; source: string }[] = [
  { url: 'https://www.reddit.com/r/AustinEvents/.rss', source: 'social:reddit-austinevents' },
  { url: 'https://www.reddit.com/r/Austin/.rss', source: 'social:reddit-austin' },
]

// Bluesky full-text searches aimed at event announcements.
const BLUESKY_QUERIES = [
  'Austin live music tonight',
  'Austin show this weekend',
  'ATX event',
  'Austin festival',
]

type BlueskyPost = {
  uri?: string
  author?: { handle?: string }
  record?: { text?: string; createdAt?: string }
  indexedAt?: string
}

// Convert a Bluesky AT-URI (at://did/app.bsky.feed.post/rkey) into a public
// bsky.app permalink so events link somewhere a human can open.
function bskyPermalink(uri: string | undefined, handle: string | undefined): string | null {
  if (!uri || !handle) return null
  const rkey = uri.split('/').pop()
  return rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null
}

async function fetchBlueskyItems(): Promise<FeedItem[]> {
  const items: FeedItem[] = []
  for (const q of BLUESKY_QUERIES) {
    try {
      const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts')
      url.searchParams.set('q', q)
      url.searchParams.set('limit', '15')
      url.searchParams.set('sort', 'latest')
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'WhatItDo Events Bot/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      })
      if (!res.ok) {
        console.warn(`Bluesky search "${q}" returned HTTP ${res.status}`)
        continue
      }
      const data = (await res.json()) as { posts?: BlueskyPost[] }
      for (const p of data.posts ?? []) {
        const text = p.record?.text?.trim()
        if (!text || text.length < 12) continue
        const handle = p.author?.handle
        items.push({
          source: 'social:bluesky',
          title: text.slice(0, 120),
          content: text,
          link: bskyPermalink(p.uri, handle),
          published: p.record?.createdAt ?? p.indexedAt ?? null,
          image_url: null,
        })
      }
    } catch (e) {
      console.error(`Bluesky search "${q}" failed:`, e)
    }
  }
  return items
}

// Bluesky search → events (the config-driven `bluesky` parser). Reddit feeds are
// now plain `rss` source rows dispatched by the generic rss parser, so they no
// longer run through here.
export async function fetchBlueskyEvents(): Promise<RawEvent[]> {
  const items = await fetchBlueskyItems()
  if (items.length === 0) return []
  return extractEvents(items)
}

// Back-compat aggregate (reddit + bluesky together). Retained for the dev path;
// the orchestrator now drives reddit via `sources` rows and bluesky via the
// `bluesky` parser.
export async function fetchSocialEvents(): Promise<RawEvent[]> {
  const [redditItems, blueskyItems] = await Promise.all([
    fetchFeeds(REDDIT_FEEDS, { limit: 25 }),
    fetchBlueskyItems(),
  ])
  const items = [...redditItems, ...blueskyItems]
  if (items.length === 0) return []
  return extractEvents(items)
}
