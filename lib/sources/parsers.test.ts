import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseFeed } from './rss'
import { mapYoutubeItems } from './youtube'
import { pageFromHtml, pickRendered } from './crawler'

const fixture = (name: string) => readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')

describe('parseFeed (RSS fixture)', () => {
  const items = parseFeed(fixture('rss-newspaper.xml'), 'newspaper:kut')

  it('parses items and skips the title-less one', () => {
    expect(items).toHaveLength(2)
    expect(items[0].title).toContain('Blues on the Green')
  })

  it('never fabricates a date: published is either a real ISO date or null', () => {
    for (const it of items) {
      if (it.published !== null) {
        expect(it.published).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(Number.isNaN(new Date(it.published).getTime())).toBe(false)
      }
    }
  })

  it('published is the publication date, not the event date (no invented event time)', () => {
    // The RSS layer only knows publication dates; it must not synthesize event
    // start times. FeedItem has no start_time field at all — dates come later,
    // only from the LLM extractor, and only when concretely parseable.
    expect(items[0]).not.toHaveProperty('start_time')
  })

  it('extracts an image and strips description HTML to text', () => {
    expect(items[0].image_url).toMatch(/^https?:\/\//)
    expect(items[0].content).not.toContain('<img')
  })
})

describe('mapYoutubeItems (API fixture)', () => {
  const json = JSON.parse(fixture('youtube-search.json')) as { items: unknown[] }
  const items = mapYoutubeItems(json.items as Parameters<typeof mapYoutubeItems>[0])

  it('keeps only results with a videoId and a title', () => {
    expect(items).toHaveLength(1)
    expect(items[0].title).toContain('Austin City Limits')
  })

  it('builds a canonical watch link and carries the real publishedAt (never fabricated)', () => {
    expect(items[0].link).toBe('https://www.youtube.com/watch?v=abc123XYZ')
    expect(items[0].published).toBe('2026-06-25T17:30:00Z')
  })
})

describe('pageFromHtml (crawl fixture)', () => {
  const page = pageFromHtml(fixture('crawl-page.html'), 'https://365thingsaustin.com/weekend')

  it('prefers og:title and derives a source slug from the host', () => {
    expect(page.title).toBe('Austin Weekend Events Guide')
    expect(page.source).toMatch(/^crawl:365thingsaustin/)
  })

  it('strips scripts/styles/nav/footer and keeps main content text', () => {
    expect(page.text).toContain('Farmers Market at Mueller')
    expect(page.text).toContain('Free Yoga in the Park')
    expect(page.text).not.toContain('tracking')
    expect(page.text).not.toContain('Site nav junk')
    expect(page.text).not.toContain('Copyright junk')
  })

  it('captures the og:image', () => {
    expect(page.image_url).toBe('https://cdn.example.com/weekend.jpg')
  })
})

describe('pickRendered (BROWSER_FETCH_URL response shapes)', () => {
  it('reads crawl4ai /md shape ({markdown})', () => {
    expect(pickRendered({ markdown: 'hello world' })).toEqual({ text: 'hello world' })
  })

  it('reads crawl4ai /crawl shape ({results:[{html}]})', () => {
    expect(pickRendered({ results: [{ html: '<p>hi</p>' }] })).toEqual({ html: '<p>hi</p>' })
  })

  it('reads Firecrawl /v1/scrape shape ({success, data:{markdown}})', () => {
    expect(pickRendered({ success: true, data: { markdown: 'firecrawl content' } })).toEqual({
      text: 'firecrawl content',
    })
  })

  it('prefers html over markdown when Firecrawl returns both', () => {
    expect(pickRendered({ success: true, data: { html: '<p>rendered</p>', markdown: 'md fallback' } })).toEqual({
      html: '<p>rendered</p>',
    })
  })

  it('reads Browserless/ScrapingBee-style flat {html}/{content}', () => {
    expect(pickRendered({ html: '<p>hi</p>' })).toEqual({ html: '<p>hi</p>' })
    expect(pickRendered({ content: 'plain text' })).toEqual({ text: 'plain text' })
  })

  it('reads a bare string body', () => {
    expect(pickRendered('just text')).toEqual({ html: 'just text' })
  })

  it('returns null for empty/unrecognized shapes', () => {
    expect(pickRendered('')).toBeNull()
    expect(pickRendered({})).toBeNull()
    expect(pickRendered(null)).toBeNull()
    expect(pickRendered({ success: true, data: {} })).toBeNull()
  })
})
