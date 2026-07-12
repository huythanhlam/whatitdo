import { describe, it, expect } from 'vitest'
import { eventsFromHtml } from './culturemap'

const DAY = { y: 2026, m: 6, d: 11 } // 2026-07-11

function articleHtml(opts: {
  postId: string
  title: string
  url: string
  venueName?: string
  addr1?: string
  addr2?: string
  tags: string[]
}): string {
  return `
    <article class="clearfix event-article sm-mb-1 quality-HD post-${opts.postId}">
      <div class="widget__image crop-4x3" data-runner-img-md="https://example.com/${opts.postId}.jpg"></div>
      <div class="widget__body"><h1 class="widget__headline h1">
        <a class="widget__headline-text" href="${opts.url}">${opts.title}</a>
      </h1>
      <div class="custom-field-location"><div class="event-location-address">
        <div class="event-location-name">${opts.venueName ?? ''}</div>
        <div class="event-location-address-1">${opts.addr1 ?? ''}</div>
        <div class="event-location-address-2">${opts.addr2 ?? ''}</div>
        <div class="event-location-address-3"></div>
      </div></div></div>
      <script type="application/json" id="post-context-${opts.postId}">
        {"post": {"id": ${opts.postId}, "tags": ${JSON.stringify(opts.tags)}}}
      </script>
    </article>
  `
}

describe('eventsFromHtml', () => {
  it('extracts title, venue, address, image, ticket url, and exact time from the occurrence tag', () => {
    const html = articleHtml({
      postId: '2677203651',
      title: 'The Chambers Theatre presents Buda Summer Musical: The Wizard of Oz',
      url: 'https://austin.culturemap.com/eventdetail/buda-summer-musical/',
      addr1: 'Buda Amphitheater & City Park',
      addr2: '204 San Antonio St, Buda, TX 78610, USA',
      tags: ['20260711', 'occurrence202607112000', 'theater'],
    })
    const events = eventsFromHtml(html, 'crawl:austin-culturemap-com', '20260711', DAY)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'The Chambers Theatre presents Buda Summer Musical: The Wizard of Oz',
      venue_name: 'Buda Amphitheater & City Park',
      venue_address: '204 San Antonio St, Buda, TX 78610, USA',
      image_url: 'https://example.com/2677203651.jpg',
      ticket_url: 'https://austin.culturemap.com/eventdetail/buda-summer-musical/',
      source: 'crawl:austin-culturemap-com',
      source_id: '2677203651-20260711',
      is_free: false,
    })
    // 8:00 pm Central (CDT, UTC-5) on 2026-07-11 -> 2026-07-12T01:00:00.000Z
    expect(events[0].start_time).toBe('2026-07-12T01:00:00.000Z')
  })

  it('uses event-location-name when present, and address-1+2 as the address', () => {
    const html = articleHtml({
      postId: '1',
      title: 'Farmers Market',
      url: 'https://example.com/fm',
      venueName: 'Republic Square',
      addr1: '422 Guadalupe St',
      addr2: 'Austin, TX',
      tags: ['20260711', 'occurrence202607110900'],
    })
    const events = eventsFromHtml(html, 'src', '20260711', DAY)
    expect(events[0].venue_name).toBe('Republic Square')
    expect(events[0].venue_address).toBe('422 Guadalupe St, Austin, TX')
  })

  it('falls back to address-1 as the venue name when event-location-name is empty', () => {
    const html = articleHtml({
      postId: '2',
      title: 'Ice Age in the Wild',
      url: 'https://example.com/ice-age',
      addr1: "Lady Bird Johnson Wildflower Center",
      addr2: '4801 La Crosse Ave, Austin, TX 78739, USA',
      tags: ['20260711', 'occurrence202607110900'],
    })
    const events = eventsFromHtml(html, 'src', '20260711', DAY)
    expect(events[0].venue_name).toBe('Lady Bird Johnson Wildflower Center')
    expect(events[0].venue_address).toBe('4801 La Crosse Ave, Austin, TX 78739, USA')
  })

  it('defaults to 19:00 local when no occurrence tag matches the requested date', () => {
    const html = articleHtml({
      postId: '3',
      title: 'No Time Info',
      url: 'https://example.com/no-time',
      tags: ['20260711'],
    })
    const events = eventsFromHtml(html, 'src', '20260711', DAY)
    // 7:00 pm Central (CDT, UTC-5) -> 2026-07-12T00:00:00.000Z
    expect(events[0].start_time).toBe('2026-07-12T00:00:00.000Z')
  })

  it('skips articles with no title/url or no post-context id', () => {
    const noHeadline = `<article class="event-article"><script type="application/json" id="post-context-9">{"post":{"id":9,"tags":[]}}</script></article>`
    const noContext = `<article class="event-article"><a class="widget__headline-text" href="https://example.com/x">Untitled Has URL</a></article>`
    expect(eventsFromHtml(noHeadline, 'src', '20260711', DAY)).toEqual([])
    expect(eventsFromHtml(noContext, 'src', '20260711', DAY)).toEqual([])
  })

  it('dedupes repeated post ids within the same page', () => {
    const html =
      articleHtml({ postId: '5', title: 'Dup', url: 'https://example.com/dup', tags: ['20260711', 'occurrence202607110900'] }) +
      articleHtml({ postId: '5', title: 'Dup', url: 'https://example.com/dup', tags: ['20260711', 'occurrence202607110900'] })
    expect(eventsFromHtml(html, 'src', '20260711', DAY)).toHaveLength(1)
  })

  it('returns [] for a page with no event articles', () => {
    expect(eventsFromHtml('<div>no events today</div>', 'src', '20260711', DAY)).toEqual([])
  })
})
