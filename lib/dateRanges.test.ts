import { describe, it, expect } from 'vitest'
import { resolveDateRange } from './dateRanges'

describe('resolveDateRange', () => {
  it('is inactive with no params', () => {
    const r = resolveDateRange({})
    expect(r.active).toBe(false)
    expect(r.toIso).toBeNull()
    expect(r.label).toBeNull()
  })

  it('bounds "today" to end of the Central-time day', () => {
    const r = resolveDateRange({ when: 'today' })
    expect(r.active).toBe(true)
    expect(r.label).toBe('Today')
    expect(r.toIso).not.toBeNull()
    // end is after start
    expect(new Date(r.toIso!).getTime()).toBeGreaterThan(new Date(r.fromIso).getTime())
  })

  it('produces a valid ordered range for "weekend"', () => {
    const r = resolveDateRange({ when: 'weekend' })
    expect(r.label).toBe('This Weekend')
    expect(new Date(r.fromIso).getTime()).toBeLessThanOrEqual(new Date(r.toIso!).getTime())
  })

  it('honors explicit from/to and never returns to before from', () => {
    const r = resolveDateRange({ from: '2026-07-01', to: '2026-07-31' })
    expect(r.active).toBe(true)
    expect(new Date(r.fromIso).getTime()).toBeLessThan(new Date(r.toIso!).getTime())
  })

  it('produces ISO 8601 timestamps', () => {
    const r = resolveDateRange({ when: 'month' })
    expect(r.fromIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.toIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
