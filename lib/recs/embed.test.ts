import { describe, it, expect } from 'vitest'
import { cosine, blendVector, embeddingText } from './embed'

describe('cosine', () => {
  it('is 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('returns 0 (no signal) for missing, empty, mismatched, or zero vectors', () => {
    expect(cosine(null, [1, 2])).toBe(0)
    expect(cosine([1, 2], undefined)).toBe(0)
    expect(cosine([], [1])).toBe(0)
    expect(cosine([1, 2, 3], [1, 2])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('blendVector', () => {
  it('seeds from the embedding when there is no prior vector', () => {
    expect(blendVector(null, [1, 2, 3])).toEqual({ vec: [1, 2, 3], n: 1 })
  })

  it('is a running mean over observations', () => {
    const after1 = blendVector(null, [0, 0])
    const after2 = blendVector(after1, [2, 4])
    expect(after2.vec).toEqual([1, 2])
    expect(after2.n).toBe(2)
    const after3 = blendVector(after2, [3, 6])
    // (1*2 + 3)/3 = 1.666…, (2*2 + 6)/3 = 3.333…
    expect(after3.vec[0]).toBeCloseTo(5 / 3)
    expect(after3.vec[1]).toBeCloseTo(10 / 3)
    expect(after3.n).toBe(3)
  })

  it('re-seeds if a dimension mismatch appears (defensive)', () => {
    expect(blendVector({ vec: [1, 2], n: 5 }, [1, 2, 3])).toEqual({ vec: [1, 2, 3], n: 1 })
  })
})

describe('embeddingText', () => {
  it('combines title and a bounded description slice', () => {
    const text = embeddingText({ title: 'Jazz Night', description: 'x'.repeat(1000) })
    expect(text.startsWith('Jazz Night')).toBe(true)
    expect(text.length).toBeLessThan(600)
  })
})
