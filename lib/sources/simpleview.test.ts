import { describe, it, expect } from 'vitest'
import { eventsFromDocs } from './simpleview'

describe('eventsFromDocs', () => {
  it('maps a doc to a RawEvent', () => {
    const events = eventsFromDocs(
      [
        {
          recid: '123',
          title: 'Summer Film Series',
          startDate: '2026-07-10T05:00:00.000Z',
          endDate: '2026-08-31T04:59:59.000Z',
          location: 'Paramount Theatre',
          absoluteUrl: 'https://www.austintexas.org/event/summer-film-series/123/',
          media_raw: [{ mediaurl: 'https://example.com/img.jpg' }],
        },
      ],
      'crawl:austintexas-org'
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Summer Film Series',
      start_time: '2026-07-10T05:00:00.000Z',
      end_time: '2026-08-31T04:59:59.000Z',
      venue_name: 'Paramount Theatre',
      venue_address: null,
      image_url: 'https://example.com/img.jpg',
      ticket_url: 'https://www.austintexas.org/event/summer-film-series/123/',
      source: 'crawl:austintexas-org',
      source_id: '123',
      is_free: false,
    })
  })

  it('drops docs missing a title, url, date, or id', () => {
    const events = eventsFromDocs(
      [
        { recid: '1', startDate: '2026-07-10T05:00:00.000Z', absoluteUrl: 'https://x.com/1' }, // no title
        { recid: '2', title: 'No URL', startDate: '2026-07-10T05:00:00.000Z' }, // no url
        { recid: '3', title: 'No Date', absoluteUrl: 'https://x.com/3' }, // no startDate
        { title: 'No Id', startDate: '2026-07-10T05:00:00.000Z', absoluteUrl: 'https://x.com/4' }, // no recid/id
      ],
      'crawl:austintexas-org'
    )
    expect(events).toEqual([])
  })

  it('falls back to id when recid is absent', () => {
    const events = eventsFromDocs(
      [{ id: 'abc', title: 'Event', startDate: '2026-07-10T05:00:00.000Z', absoluteUrl: 'https://x.com/1' }],
      'crawl:austintexas-org'
    )
    expect(events[0].source_id).toBe('abc')
  })

  it('dedupes by source_id', () => {
    const dup = { recid: 'dup', title: 'Dup', startDate: '2026-07-10T05:00:00.000Z', absoluteUrl: 'https://x.com/dup' }
    expect(eventsFromDocs([dup, dup], 'crawl:austintexas-org')).toHaveLength(1)
  })

  it('returns [] for an empty doc list', () => {
    expect(eventsFromDocs([], 'crawl:austintexas-org')).toEqual([])
  })
})
