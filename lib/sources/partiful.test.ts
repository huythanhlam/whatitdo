import { describe, it, expect } from 'vitest'
import { eventsFromNextData } from './partiful'

function pageProps(overrides: Record<string, unknown>) {
  return { props: { pageProps: overrides } }
}

describe('eventsFromNextData', () => {
  it('finds an event nested in a trending carousel', () => {
    const data = pageProps({
      trendingSection: {
        items: [
          {
            id: 'event',
            type: 'event',
            event: {
              id: 'abc123',
              title: 'Novel Writing Workshop',
              description: 'Learn to write.',
              startDate: '2026-07-11T19:00:00.000Z',
              endDate: '2026-07-11T21:30:00.000Z',
              isPublic: true,
              locationInfo: { mapsInfo: { name: 'Pflugerville Library', addressLines: ['1008 W Pfluger St', 'Pflugerville, TX'] } },
              image: { url: 'https://example.com/img.png' },
            },
          },
        ],
      },
    })
    const events = eventsFromNextData(data, 'crawl:partiful-com')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Novel Writing Workshop',
      start_time: '2026-07-11T19:00:00.000Z',
      venue_name: 'Pflugerville Library',
      venue_address: '1008 W Pfluger St, Pflugerville, TX',
      ticket_url: 'https://partiful.com/e/abc123',
      source: 'crawl:partiful-com',
      source_id: 'abc123',
    })
  })

  it('finds events regardless of which section they are nested under', () => {
    const data = pageProps({
      sections: [{ title: 'Out and About', items: [{ event: { id: 'x1', title: 'Yard Sale', startDate: '2026-07-11T15:00:00.000Z' } }] }],
      feedItems: [{ event: { id: 'x2', title: 'Craft Night', startDate: '2026-07-15T23:30:00.000Z' } }],
    })
    const events = eventsFromNextData(data, 'crawl:partiful-com')
    expect(events.map(e => e.title).sort()).toEqual(['Craft Night', 'Yard Sale'])
  })

  it('dedupes the same event id surfacing in multiple sections', () => {
    const shared = { id: 'dup1', title: 'Shared Event', startDate: '2026-07-11T15:00:00.000Z' }
    const data = pageProps({
      trendingSection: { items: [{ event: shared }] },
      feedItems: [{ event: shared }],
    })
    expect(eventsFromNextData(data, 'crawl:partiful-com')).toHaveLength(1)
  })

  it('excludes events explicitly marked non-public', () => {
    const data = pageProps({
      feedItems: [{ event: { id: 'priv', title: 'Private Party', startDate: '2026-07-11T15:00:00.000Z', isPublic: false } }],
    })
    expect(eventsFromNextData(data, 'crawl:partiful-com')).toEqual([])
  })

  it('falls back to null venue when no locationInfo is present', () => {
    const data = pageProps({
      feedItems: [{ event: { id: 'nov', title: 'No Venue Event', startDate: '2026-07-11T15:00:00.000Z' } }],
    })
    const events = eventsFromNextData(data, 'crawl:partiful-com')
    expect(events[0].venue_name).toBeNull()
    expect(events[0].venue_address).toBeNull()
  })

  it('returns [] when pageProps has no event-shaped objects', () => {
    expect(eventsFromNextData(pageProps({ hostname: 'partiful.com', region: 'ATX' }), 'crawl:partiful-com')).toEqual([])
  })
})
