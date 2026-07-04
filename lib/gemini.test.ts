import { describe, it, expect } from 'vitest'
import { mapPool } from './gemini'

describe('mapPool', () => {
  it('preserves input order in the output', async () => {
    const out = await mapPool([1, 2, 3, 4, 5], 2, async n => n * 10)
    expect(out).toEqual([10, 20, 30, 40, 50])
  })

  it('returns [] for empty input', async () => {
    expect(await mapPool([], 4, async n => n)).toEqual([])
  })

  it('never runs more than `limit` tasks concurrently', async () => {
    let active = 0
    let peak = 0
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('passes the index to the mapper', async () => {
    const out = await mapPool(['a', 'b', 'c'], 2, async (_v, i) => i)
    expect(out).toEqual([0, 1, 2])
  })
})
