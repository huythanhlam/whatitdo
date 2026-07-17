import { describe, it, expect } from 'vitest'
import {
  computeFeatures,
  scoreFeatures,
  rankCandidates,
  type Candidate,
  type ActorTaste,
} from './score'
import { V1_MODEL_WEIGHTS } from './config'

const NOW = new Date('2026-07-17T12:00:00Z').getTime()

function cand(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    categorySlugs: ['music'],
    venueNorm: `venue-${id}`,
    neighborhood: null,
    isFree: false,
    startTime: '2026-07-18T20:00:00Z',
    engagementScore: 0.1,
    embedding: null,
    seenCount: 0,
    ...over,
  }
}

function taste(entries: [string, number][] = [], vector: number[] | null = null): ActorTaste {
  return { affinity: new Map(entries), vector }
}

describe('computeFeatures', () => {
  it('takes the max category affinity across an event’s categories', () => {
    const f = computeFeatures(
      cand('a', { categorySlugs: ['music', 'arts'] }),
      taste([['category:arts', 0.9], ['category:music', 0.2]]),
      NOW,
    )
    expect(f.category_affinity).toBe(0.9)
  })

  it('reads free-price preference only for free events', () => {
    const t = taste([['price:free_only', 0.8]])
    expect(computeFeatures(cand('a', { isFree: true }), t, NOW).price_fit).toBe(0.8)
    expect(computeFeatures(cand('a', { isFree: false }), t, NOW).price_fit).toBe(0)
  })

  it('falls back to the city-average engagement prior when unscored', () => {
    expect(computeFeatures(cand('a', { engagementScore: null }), taste(), NOW).engagement_prior).toBeGreaterThan(0)
  })

  it('decreases proximity as the event gets further out', () => {
    const soon = computeFeatures(cand('a', { startTime: '2026-07-17T18:00:00Z' }), taste(), NOW).proximity
    const later = computeFeatures(cand('a', { startTime: '2026-07-30T18:00:00Z' }), taste(), NOW).proximity
    expect(soon).toBeGreaterThan(later)
  })

  it('uses cosine similarity for the embedding feature', () => {
    const f = computeFeatures(cand('a', { embedding: [1, 0] }), taste([], [1, 0]), NOW)
    expect(f.embedding_sim).toBeCloseTo(1)
  })
})

describe('scoreFeatures', () => {
  it('a strong category-affinity event outscores a neutral one', () => {
    const loved = computeFeatures(cand('a'), taste([['category:music', 1]]), NOW)
    const neutral = computeFeatures(cand('b'), taste(), NOW)
    expect(scoreFeatures(loved, V1_MODEL_WEIGHTS)).toBeGreaterThan(scoreFeatures(neutral, V1_MODEL_WEIGHTS))
  })
})

describe('rankCandidates', () => {
  it('ranks an affinity-matching event first (exploitation)', () => {
    const cands = [
      cand('cold', { categorySlugs: ['sports'], venueNorm: 'v1' }),
      cand('warm', { categorySlugs: ['music'], venueNorm: 'v2' }),
    ]
    const ranked = rankCandidates(cands, taste([['category:music', 1]]), {
      weights: V1_MODEL_WEIGHTS,
      nowMs: NOW,
      limit: 2,
      exploreSlots: 0,
    })
    expect(ranked[0].id).toBe('warm')
    expect(ranked.map(r => r.position)).toEqual([0, 1])
  })

  it('caps how many events share a top category (diversity)', () => {
    // Six music events all with strong affinity; cap should hold to 3 in the top.
    const cands = Array.from({ length: 6 }, (_, i) => cand(`m${i}`, { categorySlugs: ['music'], venueNorm: `v${i}` }))
    // Plus a couple of other-category events to fill.
    cands.push(cand('c1', { categorySlugs: ['comedy'], venueNorm: 'vc1' }))
    cands.push(cand('a1', { categorySlugs: ['arts'], venueNorm: 'va1' }))
    const ranked = rankCandidates(cands, taste([['category:music', 1]]), {
      weights: V1_MODEL_WEIGHTS,
      nowMs: NOW,
      limit: 5,
      exploreSlots: 0,
      categoryCap: 3,
    })
    const musicInTop = ranked.filter(r => cands.find(c => c.id === r.id)!.categorySlugs[0] === 'music').length
    expect(musicInTop).toBeLessThanOrEqual(3)
    expect(ranked).toHaveLength(5)
  })

  it('reserves exploration slots flagged as explored', () => {
    const cands = Array.from({ length: 10 }, (_, i) =>
      cand(`e${i}`, { categorySlugs: ['music'], venueNorm: `v${i}`, engagementScore: i === 9 ? 0.001 : 0.5 }),
    )
    const ranked = rankCandidates(cands, taste([['category:music', 1]]), {
      weights: V1_MODEL_WEIGHTS,
      nowMs: NOW,
      limit: 5,
      exploreSlots: 2,
      categoryCap: 99,
      venueCap: 99,
    })
    expect(ranked.filter(r => r.explored)).toHaveLength(2)
    // The least-exposed candidate should be among the exploration picks.
    expect(ranked.some(r => r.id === 'e9' && r.explored)).toBe(true)
  })

  it('never returns more than the limit and positions are contiguous', () => {
    const cands = Array.from({ length: 30 }, (_, i) => cand(`x${i}`, { venueNorm: `v${i}` }))
    const ranked = rankCandidates(cands, taste(), { weights: V1_MODEL_WEIGHTS, nowMs: NOW, limit: 12 })
    expect(ranked).toHaveLength(12)
    expect(ranked.map(r => r.position)).toEqual([...Array(12).keys()])
  })
})
