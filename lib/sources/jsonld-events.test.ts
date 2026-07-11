import { describe, it, expect } from 'vitest'
import { toIso, eventsFromHtml } from './jsonld-events'

describe('toIso', () => {
  it('passes through well-formed ISO datetimes', () => {
    expect(toIso('2026-07-16T20:00:00-05:00')).toBe('2026-07-17T01:00:00.000Z')
  })

  it('zero-pads loosely-formatted datetimes like thelongcenter.org emits', () => {
    // Single-digit month, no seconds, single-digit tz offset.
    expect(toIso('2026-7-16T20:00-5:00')).toBe('2026-07-17T01:00:00.000Z')
  })

  it('returns null for garbage input', () => {
    expect(toIso('not a date')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(toIso(undefined)).toBeNull()
  })
})

describe('eventsFromHtml', () => {
  it('reads a single top-level Event JSON-LD block per script tag (thelongcenter.org shape)', () => {
    const html = `
      <script type="application/ld+json">{"@context":"http://schema.org","@type":"Event","name":"Show A","url":"https://example.com/a","startDate":"2026-7-16T20:00-5:00","endDate":"2026-7-16T23:59-5:00","image":"https://example.com/a.jpg"}</script>
      <script type="application/ld+json">{"@context":"http://schema.org","@type":"Event","name":"Show B","url":"https://example.com/b","startDate":"2026-08-01T19:00:00-05:00"}</script>
    `
    const events = eventsFromHtml(html, 'crawl:example-com', 'https://example.com/calendar')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      title: 'Show A',
      start_time: '2026-07-17T01:00:00.000Z',
      end_time: '2026-07-17T04:59:00.000Z',
      ticket_url: 'https://example.com/a',
      source: 'crawl:example-com',
      image_url: 'https://example.com/a.jpg',
    })
    expect(events[1].end_time).toBeNull()
  })

  it('reads Event nodes nested inside an @graph array (365thingsaustin.com shape)', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"CollectionPage","name":"Events"},
      {"@type":"Event","name":"Farmers Market","url":"https://example.com/fm","startDate":"2026-08-02T09:00:00-05:00","location":{"name":"Republic Square","address":{"streetAddress":"422 Guadalupe St","addressLocality":"Austin","addressRegion":"TX"}}}
    ]}</script>`
    const events = eventsFromHtml(html, 'crawl:example-com', 'https://example.com/events')
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Farmers Market')
    expect(events[0].venue_name).toBe('Republic Square')
    expect(events[0].venue_address).toBe('422 Guadalupe St, Austin, TX')
  })

  it('reads Event items wrapped in an ItemList (eventbrite-style shape)', () => {
    const html = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
      {"@type":"ListItem","position":1,"item":{"@type":"Event","name":"Gig Night","url":"https://example.com/gig","startDate":"2026-09-01T20:00:00-05:00"}}
    ]}</script>`
    const events = eventsFromHtml(html, 'crawl:example-com', 'https://example.com/events')
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Gig Night')
  })

  it('drops events with no name or no parseable startDate', () => {
    const html = `<script type="application/ld+json">{"@type":"Event","name":"No Date"}</script>
      <script type="application/ld+json">{"@type":"Event","startDate":"2026-09-01T20:00:00-05:00"}</script>`
    expect(eventsFromHtml(html, 'crawl:example-com', 'https://example.com')).toHaveLength(0)
  })

  it('dedupes by ticket_url and ignores malformed JSON blocks', () => {
    const html = `<script type="application/ld+json">not json</script>
      <script type="application/ld+json">{"@type":"Event","name":"Dup","url":"https://example.com/dup","startDate":"2026-09-01T20:00:00-05:00"}</script>
      <script type="application/ld+json">{"@type":"Event","name":"Dup","url":"https://example.com/dup","startDate":"2026-09-01T20:00:00-05:00"}</script>`
    expect(eventsFromHtml(html, 'crawl:example-com', 'https://example.com')).toHaveLength(1)
  })

  it('returns [] for a page with no JSON-LD at all', () => {
    expect(eventsFromHtml('<html><body>no data here</body></html>', 'crawl:example-com', 'https://example.com')).toEqual([])
  })
})
