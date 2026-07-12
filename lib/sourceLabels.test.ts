import { describe, it, expect } from 'vitest'
import { sourceLabel } from './sourceLabels'

describe('sourceLabel', () => {
  it('title-cases a bare source name', () => {
    expect(sourceLabel('eventbrite')).toBe('Eventbrite')
  })

  it('joins hyphenated words with spaces', () => {
    expect(sourceLabel('austin-gov')).toBe('Austin Gov')
  })

  it('strips the kind: prefix from namespaced sources', () => {
    expect(sourceLabel('newspaper:kut')).toBe('Kut')
    expect(sourceLabel('social:reddit-austin')).toBe('Reddit Austin')
  })

  it('drops a trailing -com from crawler host slugs', () => {
    expect(sourceLabel('crawl:do512-com')).toBe('Do512')
  })
})
