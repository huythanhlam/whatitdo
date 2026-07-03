import { describe, it, expect } from 'vitest'
import { tagByKeyword } from './tagger'

describe('tagByKeyword', () => {
  it('tags a concert as music', () => {
    expect(tagByKeyword('Live music at Mohawk', 'An indie rock concert')).toContain('music')
  })

  it('tags a comedy show as comedy', () => {
    expect(tagByKeyword('Stand-up comedy night', null)).toContain('comedy')
  })

  it('falls back to ["other"] when nothing matches', () => {
    expect(tagByKeyword('Zzzxqq', 'nondescript happening')).toEqual(['other'])
  })

  it('returns at most 3 slugs', () => {
    const slugs = tagByKeyword('Family food festival with live music and a movie screening', 'art market too')
    expect(slugs.length).toBeLessThanOrEqual(3)
  })

  it('can return multiple categories', () => {
    const slugs = tagByKeyword('Food and wine festival', 'a culinary celebration')
    expect(slugs).toContain('food-drink')
    expect(slugs).toContain('festivals')
  })
})
