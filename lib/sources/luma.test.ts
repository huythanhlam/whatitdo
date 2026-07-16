import { describe, it, expect } from 'vitest'
import { eventsFromEntries, slugFromUrl, placeApiIdFromNextData } from './luma'

function entry(overrides: Record<string, unknown> = {}, ticketOverrides: Record<string, unknown> | null = {}) {
  return {
    event: {
      api_id: 'evt-1',
      name: 'Austin Founders Mixer',
      start_at: '2026-07-25T18:00:00.000Z',
      end_at: '2026-07-25T20:00:00.000Z',
      url: 'founders-mixer',
      location_type: 'offline',
      geo_address_info: { address: 'Capital Factory', full_address: '701 Brazos St, Austin, TX 78701, USA' },
      cover_url: 'https://images.lumacdn.com/cover.png',
      ...overrides,
    },
    ticket_info: ticketOverrides === null ? null : { is_free: true, price: null, ...ticketOverrides },
  }
}

describe('slugFromUrl', () => {
  it('extracts the last path segment', () => {
    expect(slugFromUrl('https://luma.com/austin')).toBe('austin')
  })

  it('handles a trailing slash', () => {
    expect(slugFromUrl('https://luma.com/austin/')).toBe('austin')
  })

  it('returns null for a path-less URL', () => {
    expect(slugFromUrl('https://luma.com/')).toBeNull()
  })

  it('returns null for an unparseable URL', () => {
    expect(slugFromUrl('not a url')).toBeNull()
  })
})

describe('placeApiIdFromNextData', () => {
  function nextData(placeOverrides: Record<string, unknown> | undefined) {
    return { props: { pageProps: { initialData: { data: placeOverrides === undefined ? {} : { place: placeOverrides } } } } }
  }

  it('extracts place.api_id from the discover page payload', () => {
    expect(placeApiIdFromNextData(nextData({ api_id: 'discplace-abc123' }))).toBe('discplace-abc123')
  })

  it('returns null when place is missing', () => {
    expect(placeApiIdFromNextData(nextData(undefined))).toBeNull()
  })

  it('returns null when api_id is not a string', () => {
    expect(placeApiIdFromNextData(nextData({ api_id: 12345 }))).toBeNull()
  })

  it('returns null for a malformed payload', () => {
    expect(placeApiIdFromNextData(null)).toBeNull()
    expect(placeApiIdFromNextData(undefined)).toBeNull()
    expect(placeApiIdFromNextData('not an object')).toBeNull()
    expect(placeApiIdFromNextData({})).toBeNull()
  })
})

describe('eventsFromEntries', () => {
  it('maps a physical, free event', () => {
    const events = eventsFromEntries([entry()], 'crawl:luma-com')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Austin Founders Mixer',
      description: null,
      start_time: '2026-07-25T18:00:00.000Z',
      end_time: '2026-07-25T20:00:00.000Z',
      venue_name: 'Capital Factory',
      venue_address: '701 Brazos St, Austin, TX 78701, USA',
      image_url: 'https://images.lumacdn.com/cover.png',
      ticket_url: 'https://luma.com/founders-mixer',
      source: 'crawl:luma-com',
      source_id: 'evt-1',
      is_free: true,
      price_min: null,
      price_max: null,
    })
  })

  it('converts a paid ticket price from cents to dollars', () => {
    const events = eventsFromEntries(
      [entry({ api_id: 'evt-2' }, { is_free: false, price: { cents: 3200, currency: 'usd' } })],
      'luma'
    )
    expect(events[0]).toMatchObject({ is_free: false, price_min: 32, price_max: 32 })
  })

  it('maps an online event to a null-address "Online" venue', () => {
    const events = eventsFromEntries([entry({ api_id: 'evt-3', location_type: 'online', geo_address_info: undefined })], 'luma')
    expect(events[0].venue_name).toBe('Online')
    expect(events[0].venue_address).toBeNull()
  })

  it('falls back to city_state when the exact address is obfuscated', () => {
    const events = eventsFromEntries(
      [entry({ api_id: 'evt-4', geo_address_info: { city_state: 'Austin, TX' } })],
      'luma'
    )
    expect(events[0].venue_name).toBeNull()
    expect(events[0].venue_address).toBe('Austin, TX')
  })

  it('falls back to social_image_url when cover_url is absent', () => {
    const events = eventsFromEntries(
      [entry({ api_id: 'evt-5', cover_url: undefined, social_image_url: 'https://images.lumacdn.com/social.png' })],
      'luma'
    )
    expect(events[0].image_url).toBe('https://images.lumacdn.com/social.png')
  })

  it('dedupes the same event id appearing twice', () => {
    const e = entry()
    expect(eventsFromEntries([e, e], 'luma')).toHaveLength(1)
  })

  it('drops entries missing a name or start_at', () => {
    const events = eventsFromEntries(
      [entry({ name: undefined }), entry({ api_id: 'evt-6', start_at: undefined })],
      'luma'
    )
    expect(events).toEqual([])
  })

  it('treats a missing ticket_info as free', () => {
    const events = eventsFromEntries([entry({}, null)], 'luma')
    expect(events[0]).toMatchObject({ is_free: true, price_min: null })
  })

  it('returns [] for a non-array entries value', () => {
    expect(eventsFromEntries(null, 'luma')).toEqual([])
    expect(eventsFromEntries(undefined, 'luma')).toEqual([])
    expect(eventsFromEntries('not an array', 'luma')).toEqual([])
  })

  describe('targetState filtering', () => {
    it('keeps an event whose address state matches targetState', () => {
      const events = eventsFromEntries([entry()], 'luma', 'TX')
      expect(events).toHaveLength(1)
    })

    it('drops an event whose address resolves to a different state (e.g. a DC event leaking into an Austin feed)', () => {
      const events = eventsFromEntries(
        [entry({ api_id: 'evt-dc', geo_address_info: { full_address: '1600 Pennsylvania Ave NW, Washington, DC 20500, USA' } })],
        'luma',
        'TX'
      )
      expect(events).toEqual([])
    })

    it('keeps an event whose city_state matches targetState', () => {
      const events = eventsFromEntries(
        [entry({ api_id: 'evt-cs', geo_address_info: { city_state: 'Round Rock, TX' } })],
        'luma',
        'TX'
      )
      expect(events).toHaveLength(1)
    })

    it('keeps an online event with no address regardless of targetState', () => {
      const events = eventsFromEntries(
        [entry({ api_id: 'evt-online', location_type: 'online', geo_address_info: undefined })],
        'luma',
        'TX'
      )
      expect(events).toHaveLength(1)
    })

    it('keeps an event whose address has no parseable state (ambiguous, not a confirmed mismatch)', () => {
      const events = eventsFromEntries(
        [entry({ api_id: 'evt-ambiguous', geo_address_info: { address: 'Some Venue', full_address: 'Somewhere Unparseable' } })],
        'luma',
        'TX'
      )
      expect(events).toHaveLength(1)
    })

    it('applies no filtering when targetState is omitted (existing behavior)', () => {
      const events = eventsFromEntries(
        [entry({ api_id: 'evt-dc', geo_address_info: { full_address: '1600 Pennsylvania Ave NW, Washington, DC 20500, USA' } })],
        'luma'
      )
      expect(events).toHaveLength(1)
    })
  })
})
