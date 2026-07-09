import { describe, it, expect } from 'vitest'
import { checkRateLimit } from './rateLimit'

describe('checkRateLimit', () => {
  it('allows up to max calls within the window, then blocks', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 60_000)).toBe(true)
    }
    expect(checkRateLimit(key, 3, 60_000)).toBe(false)
  })

  it('tracks separate keys independently', () => {
    const a = `test-a-${Math.random()}`
    const b = `test-b-${Math.random()}`
    expect(checkRateLimit(a, 1, 60_000)).toBe(true)
    expect(checkRateLimit(a, 1, 60_000)).toBe(false)
    expect(checkRateLimit(b, 1, 60_000)).toBe(true)
  })

  it('allows requests again once the window has passed', async () => {
    const key = `test-window-${Math.random()}`
    expect(checkRateLimit(key, 1, 50)).toBe(true)
    expect(checkRateLimit(key, 1, 50)).toBe(false)
    await new Promise(r => setTimeout(r, 60))
    expect(checkRateLimit(key, 1, 50)).toBe(true)
  })
})
