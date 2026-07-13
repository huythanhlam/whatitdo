import { describe, it, expect } from 'vitest'
import { buildEvent, dedupeEvents, buildEventsFromPage, type ExtractedEvent, type CrawlPage } from './extractor'
import type { FeedItem } from './sources/rss'
import type { RawEvent } from './sources/types'

const NOW = '2026-07-01T12:00:00Z'

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    source: 'newspaper:test',
    title: 'Big Show Announced',
    content: 'A concert is coming to town.',
    link: 'https://example.com/article',
    published: '2026-06-30T00:00:00Z',
    image_url: null,
    ...overrides,
  }
}

describe('buildEvent — never fabricates a date', () => {
  it('returns null when the model gives no start_time (does NOT invent one)', () => {
    const ex: ExtractedEvent = { is_event: true, title: 'Show', start_time: null }
    expect(buildEvent(item(), ex, NOW)).toBeNull()
  })

  it('returns null for an unparseable start_time', () => {
    const ex: ExtractedEvent = { is_event: true, title: 'Show', start_time: 'next friday' }
    expect(buildEvent(item(), ex, NOW)).toBeNull()
  })

  it('returns null when is_event is not true', () => {
    expect(buildEvent(item(), { is_event: false }, NOW)).toBeNull()
    expect(buildEvent(item(), null, NOW)).toBeNull()
  })

  it('rejects past events', () => {
    const ex: ExtractedEvent = { is_event: true, title: 'Show', start_time: '2026-06-01T20:00:00-05:00' }
    expect(buildEvent(item(), ex, NOW)).toBeNull()
  })

  it('rejects events absurdly far in the future', () => {
    const ex: ExtractedEvent = { is_event: true, title: 'Show', start_time: '2030-01-01T20:00:00-05:00' }
    expect(buildEvent(item(), ex, NOW)).toBeNull()
  })

  it('builds a RawEvent for a valid near-future extraction, using the parsed date verbatim', () => {
    const ex: ExtractedEvent = {
      is_event: true,
      title: 'Mohawk Indie Night',
      start_time: '2026-07-10T20:00:00-05:00',
      venue_name: 'Mohawk',
      is_free: false,
      price_min: 15,
    }
    const ev = buildEvent(item(), ex, NOW)
    expect(ev).not.toBeNull()
    expect(ev!.title).toBe('Mohawk Indie Night')
    expect(ev!.start_time).toBe(new Date('2026-07-10T20:00:00-05:00').toISOString())
    expect(ev!.venue_name).toBe('Mohawk')
    expect(ev!.price_min).toBe(15)
  })
})

describe('dedupeEvents', () => {
  it('drops rows sharing (source, source_id)', () => {
    const base: RawEvent = {
      title: 'A', description: null, start_time: NOW, end_time: null, venue_name: null,
      venue_address: null, image_url: null, ticket_url: null, source: 's', source_id: 'x',
      is_free: false, price_min: null, price_max: null,
    }
    const out = dedupeEvents([base, { ...base }, { ...base, source_id: 'y' }])
    expect(out).toHaveLength(2)
  })
})

describe('buildEventsFromPage', () => {
  it('keeps only concretely-dated events from a multi-event page', () => {
    const page: CrawlPage = {
      source: 'crawl:test', url: 'https://example.com/weekend', title: 'This Weekend', image_url: null, text: '',
    }
    const extracted: ExtractedEvent[] = [
      { title: 'Dated Show', start_time: '2026-07-05T19:00:00-05:00' },
      { title: 'Undated Thing', start_time: null }, // must be dropped, not invented
    ]
    const out = buildEventsFromPage(page, extracted, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Dated Show')
  })

  it('uses the page image for a single-event page', () => {
    const page: CrawlPage = {
      source: 'crawl:test', url: 'https://example.com/show', title: 'Big Show', image_url: 'https://example.com/show.jpg', text: '',
    }
    const extracted: ExtractedEvent[] = [{ title: 'Big Show', start_time: '2026-07-05T19:00:00-05:00' }]
    const out = buildEventsFromPage(page, extracted, NOW)
    expect(out[0].image_url).toBe('https://example.com/show.jpg')
  })

  it('does not stamp the page image onto every event on a multi-event listing page', () => {
    // A calendar/roundup page's og:image is necessarily generic (site logo,
    // default banner) — it can't be every one of several distinct events' own
    // photo, so it should be left for persist.ts's fallback chain instead.
    const page: CrawlPage = {
      source: 'crawl:test', url: 'https://example.com/calendar', title: 'Calendar', image_url: 'https://example.com/logo.jpg', text: '',
    }
    const extracted: ExtractedEvent[] = [
      { title: 'Show A', start_time: '2026-07-05T19:00:00-05:00' },
      { title: 'Show B', start_time: '2026-07-06T19:00:00-05:00' },
    ]
    const out = buildEventsFromPage(page, extracted, NOW)
    expect(out).toHaveLength(2)
    expect(out.every(e => e.image_url === null)).toBe(true)
  })
})
