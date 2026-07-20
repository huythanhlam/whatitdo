import { describe, it, expect } from 'vitest'
import { nextPageUrl } from './pagination'

describe('nextPageUrl', () => {
  it('resolves an absolute rel="next" link (Tribe list view)', () => {
    const html = `<link rel="next" href="https://365thingsaustin.com/events/list/page/2/" />`
    expect(nextPageUrl(html, 'https://365thingsaustin.com/events/list/')).toBe(
      'https://365thingsaustin.com/events/list/page/2/'
    )
  })

  it('resolves a relative rel="next" link against the page URL (Drupal pager)', () => {
    const html = `<a href="?page=1" title="Go to next page" rel="next">Next ›</a>`
    expect(nextPageUrl(html, 'https://www.austintexas.gov/events')).toBe(
      'https://www.austintexas.gov/events?page=1'
    )
  })

  it('handles href appearing before rel', () => {
    const html = `<a href="/events/list/page/3/" rel="next">Next</a>`
    expect(nextPageUrl(html, 'https://365thingsaustin.com/events/list/page/2/')).toBe(
      'https://365thingsaustin.com/events/list/page/3/'
    )
  })

  it('returns null when there is no rel="next" link', () => {
    const html = `<a href="?page=0" rel="prev">Previous</a><link rel="canonical" href="/events" />`
    expect(nextPageUrl(html, 'https://www.austintexas.gov/events')).toBeNull()
  })

  it('returns null for an empty/plain page', () => {
    expect(nextPageUrl('<html><body>no pager</body></html>', 'https://example.com')).toBeNull()
  })
})
