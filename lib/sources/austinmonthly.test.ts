import { describe, it, expect } from 'vitest'
import { parseLongDate, parseClockTime, parseListingItems, parsePrice, jsonLdEvent, toRawEvent, type ListingItem } from './austinmonthly'

describe('parseLongDate', () => {
  it('parses a full month-name date to 0-based month', () => {
    expect(parseLongDate('July 19, 2026')).toEqual({ y: 2026, m: 6, d: 19 })
    expect(parseLongDate('December 1, 2026')).toEqual({ y: 2026, m: 11, d: 1 })
  })
  it('returns null for unparseable input', () => {
    expect(parseLongDate('2026-07-19')).toBeNull()
    expect(parseLongDate('Smarch 4, 2026')).toBeNull()
    expect(parseLongDate(null)).toBeNull()
  })
})

describe('parseClockTime', () => {
  it('parses am/pm including noon/midnight edges', () => {
    expect(parseClockTime('7:00 am')).toEqual({ hh: 7, mm: 0 })
    expect(parseClockTime('10:00 PM')).toEqual({ hh: 22, mm: 0 })
    expect(parseClockTime('12:00 pm')).toEqual({ hh: 12, mm: 0 })
    expect(parseClockTime('12:30 am')).toEqual({ hh: 0, mm: 30 })
  })
  it('finds a clock inside a JSON-LD-style datetime', () => {
    expect(parseClockTime('2026-07-16 08:00 AM')).toEqual({ hh: 8, mm: 0 })
  })
  it('returns null when there is no clock', () => {
    expect(parseClockTime('July 19, 2026')).toBeNull()
    expect(parseClockTime(null)).toBeNull()
  })
})

describe('parseListingItems', () => {
  // Mirrors the real AJAX fragment: a nested <span class="seperator"> inside
  // <span class="ecp-event-time">, and a range date on the multi-day card.
  const singleDay = `<article class="event-listing list">
    <div class="post-thumbnail"><a href="https://x/events/a/"><img width="275" src="https://cdn.example.com/a.jpg" /></a></div>
    <div class="entry-container"><div class="entry-header">
      <h2 class="entry-title"><a href="https://www.austinmonthly.com/events/heatwave/">Heatwave Half Marathon - Austin</a></h2>
      <p class="event-date"><span class="ecp-event-time">July 19, 2026<span class="seperator">|</span>7:00 am<span class="seperator">-</span>10:00 am</span></p>
    </div></div>
  </article>`
  const rangeAllDay = `<article class="event-listing list">
    <div class="entry-container"><div class="entry-header">
      <h2 class="entry-title"><a href="https://www.austinmonthly.com/events/scavenger/">Amazing Scavenger Hunt</a></h2>
      <p class="event-date"><span class="ecp-event-time">July 19, 2026 - December 31, 2026<span class="seperator">|</span>8:00 am<span class="seperator">-</span>7:00 pm</span></p>
    </div></div>
  </article>`
  const noTime = `<article class="event-listing list">
    <div class="entry-container"><div class="entry-header">
      <h2 class="entry-title"><a href="https://www.austinmonthly.com/events/exhibit/">Some Exhibit</a></h2>
      <p class="event-date"><span class="ecp-event-time">August 1, 2026</span></p>
    </div></div>
  </article>`

  it('extracts url, title, date, start/end clock and image', () => {
    const [a] = parseListingItems(singleDay)
    expect(a).toEqual({
      url: 'https://www.austinmonthly.com/events/heatwave/',
      title: 'Heatwave Half Marathon - Austin',
      date: 'July 19, 2026',
      startClock: '7:00 am',
      endClock: '10:00 am',
      image: 'https://cdn.example.com/a.jpg',
    })
  })

  it('takes the first date of a range and the day-hours as start/end', () => {
    const [a] = parseListingItems(rangeAllDay)
    expect(a).toMatchObject({ date: 'July 19, 2026', startClock: '8:00 am', endClock: '7:00 pm', image: null })
  })

  it('handles a card with a date but no time', () => {
    const [a] = parseListingItems(noTime)
    expect(a).toMatchObject({ date: 'August 1, 2026', startClock: null, endClock: null })
  })

  it('parses multiple cards and dedupes repeated URLs', () => {
    expect(parseListingItems(singleDay + rangeAllDay + singleDay)).toHaveLength(2)
  })

  it('returns [] for a "no events" fragment', () => {
    expect(parseListingItems('<h3 class="text-center">No Events Found</h3>')).toEqual([])
  })
})

describe('parsePrice', () => {
  it('reads a single dollar amount as paid', () => {
    expect(parsePrice({ price: '$25.98' })).toEqual({ is_free: false, price_min: 25.98, price_max: 25.98 })
  })
  it('extracts a range even when "free" appears in the text', () => {
    expect(parsePrice({ price: 'Free with general admission ($9 - $12 for ages 3-17, and $15 - $18 for adults)' }))
      .toEqual({ is_free: false, price_min: 9, price_max: 18 })
  })
  it('marks an explicit "Free" as free', () => {
    expect(parsePrice({ price: 'Free' })).toEqual({ is_free: true, price_min: null, price_max: null })
  })
  it('treats missing offers as unknown pricing', () => {
    expect(parsePrice(undefined)).toEqual({ is_free: false, price_min: null, price_max: null })
    expect(parsePrice([])).toEqual({ is_free: false, price_min: null, price_max: null })
  })
})

const heatwaveDetail = `
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Event","name":"Heatwave Half Marathon - Austin",
  "startDate":"2026-07-19 07:00 AM","endDate":"2026-07-19 10:00 AM",
  "description":"Race Day Schedule 5:30-6:45am <b>Packet Pickup</b>",
  "location":{"@type":"Place","name":"Pfennig Park","address":{"@type":"PostalAddress","streetAddress":"1316 Pfennig Ln","addressLocality":"Pflugerville","addressRegion":"TX","postalCode":"78660"}},
  "image":["https://cdn.example.com/heatwave.jpg"],
  "url":"https://eventvesta.com/events/145610/t/tickets",
  "offers":{"@type":"Offer","price":"$25.98"}
}</script>`

describe('jsonLdEvent', () => {
  it('finds the Event node', () => {
    expect(jsonLdEvent(heatwaveDetail)?.name).toBe('Heatwave Half Marathon - Austin')
  })
  it('returns null when there is no Event JSON-LD', () => {
    expect(jsonLdEvent('<html><body>nothing</body></html>')).toBeNull()
  })
})

describe('toRawEvent', () => {
  const item: ListingItem = {
    url: 'https://www.austinmonthly.com/events/heatwave/',
    title: 'Heatwave Half Marathon - Austin', date: 'July 19, 2026',
    startClock: '7:00 am', endClock: '10:00 am', image: 'https://cdn.example.com/list.jpg',
  }

  it('combines listing date/time with JSON-LD venue/price/description', () => {
    const ev = toRawEvent(item, jsonLdEvent(heatwaveDetail), 'crawl:austinmonthly-com')
    expect(ev).toMatchObject({
      title: 'Heatwave Half Marathon - Austin',
      description: 'Race Day Schedule 5:30-6:45am Packet Pickup',
      // 7:00am CDT (UTC-5) on 2026-07-19
      start_time: '2026-07-19T12:00:00.000Z',
      end_time: '2026-07-19T15:00:00.000Z',
      venue_name: 'Pfennig Park',
      venue_address: '1316 Pfennig Ln, Pflugerville, TX, 78660',
      // JSON-LD image wins over the listing thumbnail when present
      image_url: 'https://cdn.example.com/heatwave.jpg',
      ticket_url: 'https://eventvesta.com/events/145610/t/tickets',
      source: 'crawl:austinmonthly-com',
      source_id: 'https://www.austinmonthly.com/events/heatwave/',
      is_free: false,
      price_min: 25.98,
    })
  })

  it('uses the in-window LISTING date, not the JSON-LD series startDate, for a recurring/multi-day event', () => {
    // A scavenger hunt whose JSON-LD series started in 2025, still listed today.
    const recurringDetail = `<script type="application/ld+json">{"@type":"Event","name":"Scavenger Hunt","startDate":"2025-08-20 08:00 AM","endDate":"2026-12-31 07:00 PM","location":{"name":"Downtown"}}</script>`
    const listItem: ListingItem = {
      url: 'https://www.austinmonthly.com/events/scavenger/', title: 'Scavenger Hunt',
      date: 'July 19, 2026', startClock: '8:00 am', endClock: '7:00 pm', image: null,
    }
    const ev = toRawEvent(listItem, jsonLdEvent(recurringDetail), 'src')!
    expect(ev.start_time).toBe('2026-07-19T13:00:00.000Z') // 8am CDT on the LISTING date, not 2025
    expect(ev.end_time).toBe('2026-07-20T00:00:00.000Z') // 7pm CDT same day
  })

  it('falls back to listing title/image/url when the detail page has no JSON-LD, and defaults an all-day start to noon', () => {
    const allDay: ListingItem = {
      url: 'https://www.austinmonthly.com/events/exhibit/', title: 'Some Exhibit',
      date: 'August 1, 2026', startClock: null, endClock: null, image: 'https://cdn.example.com/list.jpg',
    }
    const ev = toRawEvent(allDay, null, 'src')!
    expect(ev).toMatchObject({
      title: 'Some Exhibit',
      start_time: '2026-08-01T17:00:00.000Z', // noon CDT
      end_time: null,
      venue_name: null,
      image_url: 'https://cdn.example.com/list.jpg',
      ticket_url: 'https://www.austinmonthly.com/events/exhibit/',
      source_id: 'https://www.austinmonthly.com/events/exhibit/',
    })
  })

  it('rolls a past-midnight end time to the next day', () => {
    const lateNight: ListingItem = {
      url: 'https://x/events/z/', title: 'Late Show', date: 'July 24, 2026',
      startClock: '8:00 pm', endClock: '1:00 am', image: null,
    }
    const ev = toRawEvent(lateNight, null, 'src')!
    expect(ev.start_time).toBe('2026-07-25T01:00:00.000Z') // 8pm CDT Jul 24
    expect(ev.end_time).toBe('2026-07-25T06:00:00.000Z') // 1am CDT Jul 25
  })

  it('returns null without a parseable date or a title', () => {
    expect(toRawEvent({ url: 'u', title: 'T', date: null, startClock: null, endClock: null, image: null }, null, 's')).toBeNull()
    expect(toRawEvent({ url: 'u', title: null, date: 'July 1, 2026', startClock: null, endClock: null, image: null }, null, 's')).toBeNull()
  })
})
