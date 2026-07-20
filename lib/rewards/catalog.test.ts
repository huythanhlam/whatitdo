import { describe, it, expect } from 'vitest'
import { BADGES, LEVELS } from './catalog'
import { BADGE_ART_SVG } from './art'

describe('reward catalog invariants', () => {
  it('has unique badge ids', () => {
    const ids = BADGES.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every badge has non-negative points and a name', () => {
    for (const b of BADGES) {
      expect(b.points, b.id).toBeGreaterThanOrEqual(0)
      expect(b.name.length, b.id).toBeGreaterThan(0)
      expect(b.description.length, b.id).toBeGreaterThan(0)
    }
  })

  it('every badge art maps to a defined illustration', () => {
    for (const b of BADGES) {
      expect(BADGE_ART_SVG[b.art], `${b.id} → ${b.art}`).toBeTypeOf('string')
      expect(BADGE_ART_SVG[b.art].length, `${b.id} → ${b.art}`).toBeGreaterThan(0)
    }
  })

  it('levels start at zero and strictly increase by minPoints', () => {
    expect(LEVELS[0].minPoints).toBe(0)
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].minPoints, LEVELS[i].id).toBeGreaterThan(LEVELS[i - 1].minPoints)
    }
  })

  it('has unique level ids', () => {
    const ids = LEVELS.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
