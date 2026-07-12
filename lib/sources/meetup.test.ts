import { describe, it, expect } from 'vitest'
import { eventsFromApolloState, keywordUrl, TOPIC_KEYWORDS } from './meetup'

function apolloState(overrides: Record<string, unknown>) {
  return { ROOT_QUERY: { __typename: 'Query' }, ...overrides }
}

describe('keywordUrl', () => {
  it('adds a keywords param to the base find URL', () => {
    expect(keywordUrl('https://www.meetup.com/find/?location=us--tx--austin&source=EVENTS', 'music')).toBe(
      'https://www.meetup.com/find/?location=us--tx--austin&source=EVENTS&keywords=music'
    )
  })

  it('overrides rather than duplicates an existing keywords param', () => {
    const url = keywordUrl('https://www.meetup.com/find/?location=us--tx--austin&keywords=old', 'new')
    expect(url).toBe('https://www.meetup.com/find/?location=us--tx--austin&keywords=new')
  })

  it('returns null for an unparseable base URL', () => {
    expect(keywordUrl('not a url', 'music')).toBeNull()
  })

  it('has no duplicate topics', () => {
    expect(new Set(TOPIC_KEYWORDS).size).toBe(TOPIC_KEYWORDS.length)
  })
})

describe('eventsFromApolloState', () => {
  it('maps a physical event, resolving its photo ref', () => {
    const state = apolloState({
      'Event:123': {
        __typename: 'Event',
        id: '123',
        title: 'Austin Founders Mixer',
        description: 'Monthly networking mixer.',
        dateTime: '2026-07-25T13:00:00-05:00',
        eventUrl: 'https://www.meetup.com/some-group/events/123/',
        eventType: 'PHYSICAL',
        venue: { name: 'Capital Factory', address: '701 Brazos St', city: 'Austin', state: 'TX' },
        feeSettings: null,
        displayPhoto: { __ref: 'PhotoInfo:999' },
        featuredEventPhoto: null,
      },
      'PhotoInfo:999': { __typename: 'PhotoInfo', highResUrl: 'https://example.com/photo.jpg' },
    })
    const events = eventsFromApolloState(state, 'crawl:meetup-com')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Austin Founders Mixer',
      start_time: '2026-07-25T18:00:00.000Z',
      venue_name: 'Capital Factory',
      venue_address: '701 Brazos St, Austin, TX',
      image_url: 'https://example.com/photo.jpg',
      ticket_url: 'https://www.meetup.com/some-group/events/123/',
      source: 'crawl:meetup-com',
      source_id: '123',
      is_free: true,
      price_min: null,
      price_max: null,
    })
  })

  it('prefers featuredEventPhoto over displayPhoto when both are present', () => {
    const state = apolloState({
      'Event:1': {
        __typename: 'Event',
        id: '1',
        title: 'Event',
        dateTime: '2026-07-25T13:00:00-05:00',
        displayPhoto: { __ref: 'PhotoInfo:a' },
        featuredEventPhoto: { __ref: 'PhotoInfo:b' },
      },
      'PhotoInfo:a': { __typename: 'PhotoInfo', highResUrl: 'https://example.com/display.jpg' },
      'PhotoInfo:b': { __typename: 'PhotoInfo', highResUrl: 'https://example.com/featured.jpg' },
    })
    expect(eventsFromApolloState(state, 'meetup')[0].image_url).toBe('https://example.com/featured.jpg')
  })

  it('maps an online event to a null-address "Online" venue', () => {
    const state = apolloState({
      'Event:online1': {
        __typename: 'Event',
        id: 'online1',
        title: 'Virtual Book Club',
        dateTime: '2026-07-25T13:00:00-05:00',
        eventType: 'ONLINE',
        venue: { name: 'Online event', address: '', city: '', state: '' },
      },
    })
    const events = eventsFromApolloState(state, 'meetup')
    expect(events[0].venue_name).toBe('Online')
    expect(events[0].venue_address).toBeNull()
  })

  it('reads a real ticket price from feeSettings and marks it not free', () => {
    const state = apolloState({
      'Event:paid1': {
        __typename: 'Event',
        id: 'paid1',
        title: 'Paid Workshop',
        dateTime: '2026-07-25T13:00:00-05:00',
        feeSettings: { amount: 25 },
      },
    })
    const events = eventsFromApolloState(state, 'meetup')
    expect(events[0]).toMatchObject({ is_free: false, price_min: 25, price_max: 25 })
  })

  it('drops entries missing a title or dateTime (e.g. a stub cache entry)', () => {
    const state = apolloState({
      'Event:notitle': { __typename: 'Event', id: 'x', dateTime: '2026-07-25T13:00:00-05:00' },
      'Event:nodate': { __typename: 'Event', id: 'y', title: 'No Date' },
    })
    expect(eventsFromApolloState(state, 'meetup')).toEqual([])
  })

  it('ignores non-Event entries in the cache', () => {
    const state = apolloState({
      'Group:1': { __typename: 'Group', id: '1', name: 'Some Group' },
      'PhotoInfo:1': { __typename: 'PhotoInfo', highResUrl: 'https://example.com/x.jpg' },
    })
    expect(eventsFromApolloState(state, 'meetup')).toEqual([])
  })

  it('returns [] for a missing or malformed apollo state', () => {
    expect(eventsFromApolloState(null, 'meetup')).toEqual([])
    expect(eventsFromApolloState(undefined, 'meetup')).toEqual([])
    expect(eventsFromApolloState('not an object', 'meetup')).toEqual([])
  })
})
