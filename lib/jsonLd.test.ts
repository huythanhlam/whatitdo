import { describe, it, expect, beforeAll } from 'vitest'
import {
  singleEventJsonLd,
  eventListJsonLd,
  jsonLdHtml,
  organizationJsonLd,
} from './jsonLd'
import type { EnrichedEvent } from './types'

const city = { name: 'Austin', state: 'TX' }

function makeEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    id: 'evt-1',
    title: 'Live Music Night',
    description: 'A show.',
    start_time: '2026-08-01T01:00:00.000Z',
    end_time: '2026-08-01T04:00:00.000Z',
    venue_name: 'The Venue',
    venue_address: '123 Main St',
    image_url: 'https://cdn.example.com/x.jpg',
    ticket_url: 'https://tickets.example.com/x',
    source: 'venue',
    source_id: null,
    is_free: false,
    price_min: 45,
    price_max: 120,
    city_id: 1,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  } as EnrichedEvent
}

beforeAll(() => {
  process.env.SITE_URL = 'https://whatitdo.app'
})

describe('eventJsonLd', () => {
  it('emits the required rich-result fields with an absolute URL', () => {
    const e = singleEventJsonLd(makeEvent(), 'austin', city)
    expect(e['@context']).toBe('https://schema.org')
    expect(e['@type']).toBe('Event')
    expect(e.name).toBe('Live Music Night')
    expect(e.startDate).toBe('2026-08-01T01:00:00.000Z')
    expect(e.url).toBe('https://whatitdo.app/austin/events/evt-1')
    expect(e.location).toBeDefined()
  })

  it('falls back to the city as the location when no venue is known', () => {
    const e = singleEventJsonLd(
      makeEvent({ venue_name: null, venue_address: null }),
      'austin',
      city,
    )
    const loc = e.location as Record<string, unknown>
    expect(loc.name).toBe('Austin')
    const addr = loc.address as Record<string, unknown>
    expect(addr.addressLocality).toBe('Austin')
    expect(addr.addressRegion).toBe('TX')
  })

  it('emits a zero-price offer for free events', () => {
    const e = singleEventJsonLd(makeEvent({ is_free: true, price_min: null }), 'austin', city)
    expect(e.offers).toMatchObject({ price: 0, priceCurrency: 'USD' })
  })

  it('emits a URL-only offer (no invalid price/currency) when a paid price is unknown', () => {
    const e = singleEventJsonLd(makeEvent({ is_free: false, price_min: null }), 'austin', city)
    const offer = e.offers as Record<string, unknown>
    expect(offer.url).toBe('https://tickets.example.com/x')
    expect(offer).not.toHaveProperty('price')
    expect(offer).not.toHaveProperty('priceCurrency')
  })

  it('omits offers entirely when there is neither a price nor a ticket URL', () => {
    const e = singleEventJsonLd(
      makeEvent({ is_free: false, price_min: null, ticket_url: null }),
      'austin',
      city,
    )
    expect(e.offers).toBeUndefined()
  })
})

describe('jsonLdHtml (inline-script escaping)', () => {
  it('escapes </script> in attacker-authorable fields so it cannot break out of the tag', () => {
    const markup = jsonLdHtml(
      singleEventJsonLd(makeEvent({ title: '</script><script>alert(1)</script>' }), 'austin', city),
    )
    expect(markup).not.toContain('</script>')
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('\\u003c/script\\u003e')
    // Still valid JSON that parses back to the original string.
    expect(JSON.parse(markup).name).toBe('</script><script>alert(1)</script>')
  })
})

describe('eventListJsonLd', () => {
  it('wraps events in a positioned ItemList', () => {
    const list = eventListJsonLd([makeEvent({ id: 'a' }), makeEvent({ id: 'b' })], 'austin', city)
    expect(list['@type']).toBe('ItemList')
    const items = list.itemListElement as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0].position).toBe(1)
    expect(items[1].position).toBe(2)
    expect((items[0].item as Record<string, unknown>)['@type']).toBe('Event')
  })
})

describe('organizationJsonLd', () => {
  it('uses the configured base URL', () => {
    const org = organizationJsonLd()
    expect(org.url).toBe('https://whatitdo.app')
    expect(org.logo).toBe('https://whatitdo.app/logo-icon.svg')
  })
})
