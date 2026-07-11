import { describe, it, expect } from 'vitest'
import { buildPageUrls, dedupePages } from './paginated-crawl'

describe('buildPageUrls', () => {
  it('returns just the base URL when maxPages is 1', () => {
    expect(buildPageUrls('https://example.com/events?v=g', 1)).toEqual(['https://example.com/events?v=g'])
  })

  it('leaves page 1 unchanged and appends page=2 for the second page', () => {
    const urls = buildPageUrls('https://calendar.austinchronicle.com/austin/EventSearch?feature=Staff+Pick&sortType=date&v=g', 2)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toBe('https://calendar.austinchronicle.com/austin/EventSearch?feature=Staff+Pick&sortType=date&v=g')
    expect(urls[1]).toContain('page=2')
    expect(urls[1]).toContain('feature=Staff+Pick')
    expect(urls[1]).toContain('sortType=date')
  })

  it('builds one URL per page up to maxPages, incrementing the page param', () => {
    const urls = buildPageUrls('https://example.com/events', 4)
    expect(urls).toHaveLength(4)
    expect(urls[1]).toContain('page=2')
    expect(urls[2]).toContain('page=3')
    expect(urls[3]).toContain('page=4')
  })

  it('overwrites an existing page param rather than duplicating it', () => {
    const urls = buildPageUrls('https://example.com/events?page=1', 2)
    expect(urls[1].match(/page=/g)).toHaveLength(1)
    expect(urls[1]).toContain('page=2')
  })

  it('returns just the base URL for a malformed URL instead of throwing', () => {
    expect(buildPageUrls('not a url', 3)).toEqual(['not a url'])
  })
})

describe('dedupePages', () => {
  const page = (text: string, url = 'https://example.com'): { source: string; url: string; title: null; image_url: null; text: string } => ({
    source: 'crawl:example-com',
    url,
    title: null,
    image_url: null,
    text,
  })

  it('drops nulls', () => {
    expect(dedupePages([page('a'), null, page('b')])).toHaveLength(2)
  })

  it('keeps the first occurrence and drops a later page with identical text', () => {
    const p1 = page('same content', 'https://example.com?page=1')
    const p2 = page('same content', 'https://example.com?page=2')
    const result = dedupePages([p1, p2])
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe(p1.url)
  })

  it('keeps distinct pages', () => {
    expect(dedupePages([page('page one text'), page('page two text')])).toHaveLength(2)
  })

  it('returns [] for an all-null input', () => {
    expect(dedupePages([null, null])).toEqual([])
  })
})
