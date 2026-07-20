import { describe, it, expect } from 'vitest'
import { collectTribeEvents } from './tribe-events'

const HORIZON = Date.parse('2026-09-17T00:00:00Z') // now + 60d in the test's frame

// A Tribe list page: JSON-LD Event blocks + an optional rel="next" link.
function page(events: { name: string; slug: string; start: string }[], next?: string): string {
  const blocks = events
    .map(
      e =>
        `<script type="application/ld+json">{"@type":"Event","name":"${e.name}","url":"https://365thingsaustin.com/e/${e.slug}","startDate":"${e.start}"}</script>`
    )
    .join('\n')
  const nextLink = next ? `<link rel="next" href="${next}" />` : ''
  return `<html><head>${nextLink}</head><body>${blocks}</body></html>`
}

// Two "featured" events that repeat verbatim on every page.
const FEATURED = [
  { name: 'Featured A', slug: 'featured-a', start: '2026-07-21T17:30:00-05:00' },
  { name: 'Featured B', slug: 'featured-b', start: '2026-07-22T00:00:00-05:00' },
]

describe('collectTribeEvents', () => {
  it('follows rel="next", dedupes repeated featured events, and stops once past the horizon', async () => {
    const base = 'https://365thingsaustin.com/events/list/'
    const pages: Record<string, string> = {
      [base]: page([...FEATURED, { name: 'Aug', slug: 'aug', start: '2026-08-02T09:00:00-05:00' }], `${base}page/2/`),
      [`${base}page/2/`]: page([...FEATURED, { name: 'Sep13', slug: 'sep13', start: '2026-09-13T19:00:00-05:00' }], `${base}page/3/`),
      // page 3's earliest NEW event is 09-26, already beyond the horizon → stop after it.
      [`${base}page/3/`]: page([...FEATURED, { name: 'Sep26', slug: 'sep26', start: '2026-09-26T19:00:00-05:00' }], `${base}page/4/`),
      [`${base}page/4/`]: page([{ name: 'Nov', slug: 'nov', start: '2026-11-08T19:00:00-05:00' }]),
    }
    const fetched: string[] = []
    const fetchPage = async (url: string) => {
      fetched.push(url)
      return pages[url] ?? null
    }

    const events = await collectTribeEvents(base, 'crawl:365thingsaustin-com', fetchPage, HORIZON)

    // page/4/ is never fetched (we stopped after page/3/).
    expect(fetched).toEqual([base, `${base}page/2/`, `${base}page/3/`])
    // Featured A + Featured B (deduped to one each) + Aug + Sep13 + Sep26 = 5.
    const titles = events.map(e => e.title).sort()
    expect(titles).toEqual(['Aug', 'Featured A', 'Featured B', 'Sep13', 'Sep26'])
  })

  it('stops at MAX_PAGES even when the horizon is never reached', async () => {
    const base = 'https://365thingsaustin.com/events/list/'
    // Every page has a fresh near-term event and always links to a next page.
    const fetched: string[] = []
    const fetchPage = async (url: string) => {
      fetched.push(url)
      const n = fetched.length
      const nextN = n + 1
      const nextUrl =
        n === 1 ? `${base}page/2/` : url.replace(/page\/\d+\/$/, `page/${nextN}/`)
      return page([{ name: `Ev${n}`, slug: `ev${n}`, start: '2026-08-01T19:00:00-05:00' }], nextUrl)
    }

    const events = await collectTribeEvents(base, 'crawl:365thingsaustin-com', fetchPage, HORIZON)

    expect(fetched.length).toBe(8) // MAX_PAGES
    expect(events.length).toBe(8)
  })

  it('stops when a page has no rel="next" link', async () => {
    const base = 'https://365thingsaustin.com/events/list/'
    const fetchPage = async (url: string) =>
      url === base ? page([{ name: 'Only', slug: 'only', start: '2026-08-01T19:00:00-05:00' }]) : null
    const events = await collectTribeEvents(base, 'src', fetchPage, HORIZON)
    expect(events.map(e => e.title)).toEqual(['Only'])
  })

  it('stops when a page adds no new events (no forward progress)', async () => {
    const base = 'https://365thingsaustin.com/events/list/'
    const pages: Record<string, string> = {
      [base]: page(FEATURED, `${base}page/2/`),
      // page 2 repeats the same featured events → nothing new → stop.
      [`${base}page/2/`]: page(FEATURED, `${base}page/3/`),
    }
    const fetched: string[] = []
    const fetchPage = async (url: string) => {
      fetched.push(url)
      return pages[url] ?? null
    }
    const events = await collectTribeEvents(base, 'src', fetchPage, HORIZON)
    expect(fetched).toEqual([base, `${base}page/2/`])
    expect(events.length).toBe(2)
  })
})
