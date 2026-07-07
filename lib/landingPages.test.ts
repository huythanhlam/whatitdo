import { describe, it, expect } from 'vitest'
import { LANDING_PAGES, getLandingPage } from './landingPages'
import { CATEGORY_SLUGS } from './categories'
import { WHEN_PRESETS } from './dateRanges'

const WHEN_VALUES = WHEN_PRESETS.map(p => p.value)

describe('landing pages config', () => {
  it('has at least 6 pages with unique, url-safe slugs', () => {
    expect(LANDING_PAGES.length).toBeGreaterThanOrEqual(6)
    const slugs = LANDING_PAGES.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
  })

  it('references only real category slugs and when presets', () => {
    for (const p of LANDING_PAGES) {
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      for (const c of p.filters.categories ?? []) {
        expect(CATEGORY_SLUGS as readonly string[]).toContain(c)
      }
      if (p.filters.when) expect(WHEN_VALUES).toContain(p.filters.when)
    }
  })

  it('getLandingPage resolves a known slug and rejects an unknown one', () => {
    expect(getLandingPage(LANDING_PAGES[0].slug)?.slug).toBe(LANDING_PAGES[0].slug)
    expect(getLandingPage('not-a-real-page')).toBeUndefined()
  })
})
