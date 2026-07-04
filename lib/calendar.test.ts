import { describe, it, expect } from 'vitest'
import { monthGrid, addMonths, eventDayKey, gridRangeIso } from './calendar'

describe('addMonths', () => {
  it('advances within a year', () => {
    expect(addMonths(2026, 5, 1)).toEqual({ year: 2026, month: 6 })
  })
  it('wraps forward across December', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
  })
  it('wraps backward across January', () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('monthGrid', () => {
  it('always returns a full 6-week (42-cell) grid', () => {
    expect(monthGrid(2026, 6)).toHaveLength(42)
    expect(monthGrid(2026, 1)).toHaveLength(42) // February
  })
  it('starts each grid on a Sunday and marks in-month days', () => {
    const cells = monthGrid(2026, 6) // July 2026
    const inMonth = cells.filter(c => c.inMonth)
    expect(inMonth).toHaveLength(31) // July has 31 days
    expect(inMonth[0].d).toBe(1)
    expect(inMonth[inMonth.length - 1].d).toBe(31)
  })
  it('produces unique day keys', () => {
    const keys = monthGrid(2026, 6).map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('eventDayKey', () => {
  it('maps a UTC evening to the correct Central-time calendar day', () => {
    // 2026-07-05T02:00:00Z is still July 4 in Central time.
    expect(eventDayKey('2026-07-05T02:00:00Z')).toBe('2026-07-04')
  })
  it('returns yyyy-mm-dd', () => {
    expect(eventDayKey('2026-07-15T18:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('gridRangeIso', () => {
  it('returns an ordered ISO range spanning the visible grid', () => {
    const { fromIso, toIso } = gridRangeIso(2026, 6)
    expect(new Date(fromIso).getTime()).toBeLessThan(new Date(toIso).getTime())
    expect(fromIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
