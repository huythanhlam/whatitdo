import { describe, it, expect } from 'vitest'
import { BADGES, LEVELS, GROUP_ORDER, GROUP_LABELS } from './catalog'
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

  // The /rewards catalog page renders badges by walking GROUP_ORDER and labeling
  // each with GROUP_LABELS. If a new badge lands in a group that isn't ordered or
  // labeled, it would silently vanish from the page — guard against that here.
  it('every badge belongs to an ordered, labeled group', () => {
    for (const b of BADGES) {
      expect(GROUP_ORDER, b.id).toContain(b.group)
      expect(GROUP_LABELS[b.group], b.id).toBeTypeOf('string')
      expect(GROUP_LABELS[b.group].length, b.id).toBeGreaterThan(0)
    }
  })

  it('GROUP_ORDER is duplicate-free and every group holds at least one badge', () => {
    expect(new Set(GROUP_ORDER).size).toBe(GROUP_ORDER.length)
    for (const g of GROUP_ORDER) {
      expect(BADGES.some(b => b.group === g), g).toBe(true)
    }
  })
})
