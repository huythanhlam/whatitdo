import { describe, it, expect } from 'vitest'
import { eventsFromHtml, parseLongDate, parseClockTime } from './meanwhile'

// Fixtures mirror live-verified markup shapes from meanwhilebeer.com/events.
function listHtml(items: string): string {
  return `<div class="event-calendar w-dyn-list"><div role="list" class="collection-list-4 w-dyn-items">${items}</div></div>`
}

function freeNoLinkItem(): string {
  return `<div role="listitem" class="collection-item-12 w-dyn-item">
    <div style="background-image:url(&quot;https://cdn.example.com/volleyball.png&quot;)" class="hover-image"></div>
    <a href="/events/volleyball-open-free-play" class="event-left w-inline-block">
      <div class="event-date-block"><div class="label-text green">Jul</div><div class="date-number">12</div></div>
      <div class="event-info-block">
        <div class="beer-style events left">July 12, 2026</div>
        <div class="beer-name events">Volleyball Open Free Play</div>
        <div class="events-sub-info">
          <div class="beer-style events">9:00 am</div>
          <div class="beer-style events divider"> | </div>
          <div class="beer-style events lower">Free Event</div>
        </div>
      </div>
    </a>
    <a href="#" class="event-right w-inline-block">
      <div class="paid-container w-condition-invisible"><div class="label-text green link">buy<br/>tickets</div></div>
      <div class="free-container"><div class="label-text green link">RSVP<br/>HERE</div></div>
    </a>
  </div>`
}

function freeWithRsvpLinkItem(): string {
  return `<div role="listitem" class="collection-item-12 w-dyn-item">
    <div style="background-image:url(&quot;https://cdn.example.com/concert.png&quot;)" class="hover-image"></div>
    <a href="/events/free-concert-gray-scot" class="event-left w-inline-block">
      <div class="event-date-block"><div class="label-text green">Jul</div><div class="date-number">12</div></div>
      <div class="event-info-block">
        <div class="beer-style events left">July 12, 2026</div>
        <div class="beer-name events">Free Concert: Gray Scot</div>
        <div class="events-sub-info">
          <div class="beer-style events">7:00 pm</div>
          <div class="beer-style events divider"> | </div>
          <div class="beer-style events lower">Free Event</div>
        </div>
      </div>
    </a>
    <a href="https://www.prekindle.com/event/11353-free-concert-gray-scot-austin" target="_blank" class="event-right w-inline-block">
      <div class="paid-container w-condition-invisible"><div class="label-text green link">buy<br/>tickets</div></div>
      <div class="free-container"><div class="label-text green link">RSVP<br/>HERE</div></div>
    </a>
  </div>`
}

function paidItem(): string {
  return `<div role="listitem" class="collection-item-12 w-dyn-item">
    <div style="background-image:url(&quot;https://cdn.example.com/ring.jpg&quot;)" class="hover-image"></div>
    <a href="/events/make-your-own-silver-ring" class="event-left w-inline-block">
      <div class="event-date-block"><div class="label-text green">Jul</div><div class="date-number">12</div></div>
      <div class="event-info-block">
        <div class="beer-style events left">July 12, 2026</div>
        <div class="beer-name events">Ticketed Class: Make Your Own Silver Ring</div>
        <div class="events-sub-info">
          <div class="beer-style events">12:30 pm</div>
          <div class="beer-style events divider w-condition-invisible"> | </div>
          <div class="beer-style events lower w-condition-invisible">Free Event</div>
        </div>
      </div>
    </a>
    <a href="https://checkout.square.site/merchant/ML4918B52BTTB/checkout/G6XPYL5" target="_blank" class="event-right w-inline-block">
      <div class="paid-container"><div class="label-text green link">buy<br/>tickets</div></div>
      <div class="free-container w-condition-invisible"><div class="label-text green link">RSVP<br/>HERE</div></div>
    </a>
  </div>`
}

describe('parseLongDate', () => {
  it('parses a full month-name date', () => {
    expect(parseLongDate('July 12, 2026')).toEqual({ y: 2026, m: 6, d: 12 })
  })

  it('returns null for an unparseable string', () => {
    expect(parseLongDate('12 July 2026')).toBeNull()
    expect(parseLongDate('')).toBeNull()
  })
})

describe('parseClockTime', () => {
  it('parses lowercase am/pm', () => {
    expect(parseClockTime('9:00 am')).toEqual({ hh: 9, mm: 0 })
    expect(parseClockTime('7:00 pm')).toEqual({ hh: 19, mm: 0 })
  })

  it('parses uppercase and midnight/noon edge cases', () => {
    expect(parseClockTime('12:30 PM')).toEqual({ hh: 12, mm: 30 })
    expect(parseClockTime('12:00 am')).toEqual({ hh: 0, mm: 0 })
  })

  it('returns null for an unparseable string', () => {
    expect(parseClockTime('noon')).toBeNull()
  })
})

describe('eventsFromHtml', () => {
  it('falls back to the detail page URL as ticket_url when event-right has no real link (RSVP-only, href="#")', () => {
    const events = eventsFromHtml(listHtml(freeNoLinkItem()), 'crawl:meanwhilebrewing-com')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Volleyball Open Free Play',
      description: null,
      venue_name: 'Meanwhile Brewing Co.',
      venue_address: '3901 Promontory Point Dr, Austin, TX 78744',
      image_url: 'https://cdn.example.com/volleyball.png',
      ticket_url: 'https://www.meanwhilebeer.com/events/volleyball-open-free-play',
      source: 'crawl:meanwhilebrewing-com',
      source_id: 'https://www.meanwhilebeer.com/events/volleyball-open-free-play',
      is_free: true,
    })
    // 9:00 am Central (CDT, UTC-5) on 2026-07-12 -> 2026-07-12T14:00:00.000Z
    expect(events[0].start_time).toBe('2026-07-12T14:00:00.000Z')
  })

  it('uses the real external link as ticket_url when one is present, even for a free event', () => {
    const events = eventsFromHtml(listHtml(freeWithRsvpLinkItem()), 'crawl:meanwhilebrewing-com')
    expect(events[0]).toMatchObject({
      ticket_url: 'https://www.prekindle.com/event/11353-free-concert-gray-scot-austin',
      is_free: true,
    })
    // 7:00 pm Central -> 2026-07-13T00:00:00.000Z
    expect(events[0].start_time).toBe('2026-07-13T00:00:00.000Z')
  })

  it('marks a ticketed event as paid, reading the visible paid/free container rather than the label text', () => {
    const events = eventsFromHtml(listHtml(paidItem()), 'crawl:meanwhilebrewing-com')
    expect(events[0]).toMatchObject({
      title: 'Ticketed Class: Make Your Own Silver Ring',
      ticket_url: 'https://checkout.square.site/merchant/ML4918B52BTTB/checkout/G6XPYL5',
      is_free: false,
      image_url: 'https://cdn.example.com/ring.jpg',
    })
  })

  it('parses every event-specific hover-image independently', () => {
    const events = eventsFromHtml(listHtml(freeNoLinkItem() + paidItem()), 'src')
    expect(events.map(e => e.image_url)).toEqual(['https://cdn.example.com/volleyball.png', 'https://cdn.example.com/ring.jpg'])
  })

  it('dedupes nothing here (each item has a distinct detail URL) but skips items missing title/date', () => {
    const noTitle = `<div class="event-calendar w-dyn-list"><div class="w-dyn-item"><a href="/events/x" class="event-left"><div class="event-info-block"><div class="beer-style events left">July 12, 2026</div></div></a></div></div>`
    expect(eventsFromHtml(noTitle, 'src')).toEqual([])

    const noDate = `<div class="event-calendar w-dyn-list"><div class="w-dyn-item"><a href="/events/x" class="event-left"><div class="event-info-block"><div class="beer-name events">No Date Event</div></div></a></div></div>`
    expect(eventsFromHtml(noDate, 'src')).toEqual([])
  })

  it('returns [] for a page with no event items', () => {
    expect(eventsFromHtml('<div>no events</div>', 'src')).toEqual([])
  })

  it('ignores unrelated w-dyn-item lists elsewhere on the page (e.g. the community section)', () => {
    const html = `
      <div class="community-collection-container w-dyn-list"><div class="w-dyn-item">
        <a href="/community/mornings-at-meanwhile" class="community-item-container"><div class="community-title">Mornings at Meanwhile</div></a>
      </div></div>
      ${listHtml(freeNoLinkItem())}
    `
    const events = eventsFromHtml(html, 'src')
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Volleyball Open Free Play')
  })
})
