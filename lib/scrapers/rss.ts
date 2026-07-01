import * as cheerio from 'cheerio'

// A single normalized entry from any RSS 2.0 or Atom feed. Newspapers and most
// social platforms publish prose (articles / posts), not structured events — so
// a FeedItem is raw text that the LLM extractor (lib/extractor) turns into
// concrete events. `published` is the *publication* date, never the event date.
export type FeedItem = {
  source: string
  title: string
  content: string | null
  link: string | null
  published: string | null // ISO 8601, or null if unparseable
  image_url: string | null
}

// Collapse a chunk of HTML/markup into readable plain text. Feed descriptions
// frequently embed <figure>/<img>/<a> markup and HTML entities. (cheerio
// decodes entities and strips tags; `.root().text()` returns all text.)
function htmlToText(html: string): string {
  if (!html) return ''
  return cheerio.load(html).root().text().replace(/\s+/g, ' ').trim()
}

// RFC-822 (RSS) and ISO-8601 (Atom) both parse via the Date constructor.
function toIso(raw: string | undefined | null): string | null {
  if (!raw) return null
  const d = new Date(raw.trim())
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// Pull a usable image URL out of an item: media:* extensions, an <enclosure>,
// or the first <img> embedded in the description HTML. `$el` is a cheerio-
// wrapped node (type left to inference for cross-version compatibility).
function extractImage($el: ReturnType<ReturnType<typeof cheerio.load>>, descHtml: string): string | null {
  const candidates = [
    $el.find('media\\:content[url]').attr('url'),
    $el.find('media\\:thumbnail[url]').attr('url'),
    $el.find('enclosure[type^="image"]').attr('url'),
    $el.find('enclosure[url]').attr('url'),
  ]
  for (const c of candidates) {
    if (c && /^https?:\/\//i.test(c)) return c
  }
  if (descHtml) {
    const m = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (m && /^https?:\/\//i.test(m[1])) return m[1]
  }
  return null
}

// Parse a raw feed body (RSS 2.0 or Atom) into normalized FeedItems. Pure and
// network-free so it can be unit-tested against fixtures.
export function parseFeed(xml: string, source: string): FeedItem[] {
  if (!xml || !xml.trim()) return []

  let $: ReturnType<typeof cheerio.load>
  try {
    // xmlMode preserves namespaced tags (media:content) and CDATA. Passed via
    // htmlparser2 option names that both the bundled and legacy cheerio typings
    // accept.
    $ = cheerio.load(xml, { xmlMode: true, decodeEntities: true })
  } catch {
    return []
  }

  const items: FeedItem[] = []
  const nodes = $('item').length ? $('item') : $('entry') // RSS uses <item>, Atom <entry>

  nodes.each((_, el) => {
    const $el = $(el)

    const title = htmlToText($el.find('title').first().text() || $el.find('title').first().html() || '')
    if (!title) return

    // Atom <link href="..."> vs RSS <link>text</link>.
    const link =
      $el.find('link[href]').first().attr('href') ||
      $el.find('link').first().text().trim() ||
      $el.find('guid').first().text().trim() ||
      null

    // Prefer the richest body field available.
    const descHtml =
      $el.find('content\\:encoded').first().text() ||
      $el.find('content').first().text() ||
      $el.find('description').first().text() ||
      $el.find('summary').first().text() ||
      ''
    const content = htmlToText(descHtml) || null

    const published = toIso(
      $el.find('pubDate').first().text() ||
        $el.find('published').first().text() ||
        $el.find('updated').first().text() ||
        $el.find('dc\\:date').first().text()
    )

    items.push({
      source,
      title,
      content,
      link: link && /^https?:\/\//i.test(link) ? link : link || null,
      published,
      image_url: extractImage($el, descHtml),
    })
  })

  return items
}

// Fetch and parse a single feed. Never throws — returns [] on any network,
// status, or parse failure so one bad feed can't sink an ingest run.
export async function fetchFeed(
  url: string,
  source: string,
  opts: { limit?: number; timeoutMs?: number } = {}
): Promise<FeedItem[]> {
  const { limit = 25, timeoutMs = 15000 } = opts
  try {
    const res = await fetch(url, {
      headers: {
        // A descriptive UA + Accept improves success rates with Reddit and
        // WordPress/news CDNs that reject blank or bot-like agents.
        'User-Agent': 'Mozilla/5.0 (compatible; WhatItDo Events Bot/1.0; +https://whatitdo.app)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`Feed ${source} returned HTTP ${res.status}`)
      return []
    }
    const body = await res.text()
    return parseFeed(body, source).slice(0, limit)
  } catch (e) {
    console.error(`Failed to fetch feed ${source} (${url}):`, e)
    return []
  }
}

// Fetch many feeds concurrently; failures are isolated per feed.
export async function fetchFeeds(
  feeds: { url: string; source: string }[],
  opts: { limit?: number; timeoutMs?: number } = {}
): Promise<FeedItem[]> {
  const settled = await Promise.allSettled(feeds.map(f => fetchFeed(f.url, f.source, opts)))
  return settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []))
}
