import { describe, it, expect } from 'vitest'
import { filterEventsForSubscriber } from './digest'

function mkEvent(overrides: Partial<{
  id: string; is_free: boolean; categories: { slug: string }[]; neighborhood: string | null
}> = {}) {
  return {
    id: 'e1', is_free: false, categories: [], neighborhood: null,
    ...overrides,
  } as never
}

describe('filterEventsForSubscriber', () => {
  it('returns everything when no preferences are set', () => {
    const events = [mkEvent({ id: 'a' }), mkEvent({ id: 'b' })]
    const result = filterEventsForSubscriber(events, { category_slugs: [], free_only: false, neighborhoods: [] })
    expect(result).toHaveLength(2)
  })

  it('filters by category_slugs', () => {
    const music = mkEvent({ id: 'music', categories: [{ slug: 'music' }] })
    const art = mkEvent({ id: 'art', categories: [{ slug: 'art' }] })
    const result = filterEventsForSubscriber([music, art], { category_slugs: ['music'], free_only: false, neighborhoods: [] })
    expect(result.map((e: { id: string }) => e.id)).toEqual(['music'])
  })

  it('filters by free_only', () => {
    const free = mkEvent({ id: 'free', is_free: true })
    const paid = mkEvent({ id: 'paid', is_free: false })
    const result = filterEventsForSubscriber([free, paid], { category_slugs: [], free_only: true, neighborhoods: [] })
    expect(result.map((e: { id: string }) => e.id)).toEqual(['free'])
  })

  it('filters by neighborhoods, excluding events with no geocoded neighborhood', () => {
    const downtown = mkEvent({ id: 'downtown', neighborhood: 'Downtown' })
    const zilker = mkEvent({ id: 'zilker', neighborhood: 'Zilker' })
    const ungeocoded = mkEvent({ id: 'ungeocoded', neighborhood: null })
    const result = filterEventsForSubscriber([downtown, zilker, ungeocoded], {
      category_slugs: [], free_only: false, neighborhoods: ['Downtown'],
    })
    expect(result.map((e: { id: string }) => e.id)).toEqual(['downtown'])
  })

  it('combines all three filters', () => {
    const match = mkEvent({ id: 'match', categories: [{ slug: 'music' }], is_free: true, neighborhood: 'Downtown' })
    const wrongCategory = mkEvent({ id: 'wrong-category', categories: [{ slug: 'art' }], is_free: true, neighborhood: 'Downtown' })
    const notFree = mkEvent({ id: 'not-free', categories: [{ slug: 'music' }], is_free: false, neighborhood: 'Downtown' })
    const wrongNeighborhood = mkEvent({ id: 'wrong-neighborhood', categories: [{ slug: 'music' }], is_free: true, neighborhood: 'Zilker' })
    const result = filterEventsForSubscriber([match, wrongCategory, notFree, wrongNeighborhood], {
      category_slugs: ['music'], free_only: true, neighborhoods: ['Downtown'],
    })
    expect(result.map((e: { id: string }) => e.id)).toEqual(['match'])
  })
})
