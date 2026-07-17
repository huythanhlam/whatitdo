import { describe, it, expect } from 'vitest'
import { surveyToAffinityKeys, surveyToInterestRows } from './interests'

describe('surveyToAffinityKeys', () => {
  it('maps each pick to the scorer\'s kind/value', () => {
    const keys = surveyToAffinityKeys({
      categories: ['music', 'comedy'],
      neighborhoods: ['Downtown'],
      freeOnly: true,
      days: [5, 6],
    })
    expect(keys).toEqual([
      { kind: 'category', value: 'music' },
      { kind: 'category', value: 'comedy' },
      { kind: 'neighborhood', value: 'Downtown' },
      { kind: 'dow', value: '5' },
      { kind: 'dow', value: '6' },
      { kind: 'price', value: 'free_only' },
    ])
  })

  it('omits the price key when freeOnly is false, and is empty for no picks', () => {
    expect(surveyToAffinityKeys({ categories: [], neighborhoods: [], freeOnly: false, days: [] })).toEqual([])
    const keys = surveyToAffinityKeys({ categories: ['arts'], neighborhoods: [], freeOnly: false, days: [] })
    expect(keys).toEqual([{ kind: 'category', value: 'arts' }])
  })
})

describe('surveyToInterestRows', () => {
  it('mirrors the affinity keys with a positive weight', () => {
    const rows = surveyToInterestRows({ categories: ['music'], neighborhoods: [], freeOnly: true, days: [0] })
    expect(rows).toEqual([
      { kind: 'category', value: 'music', weight: 1.0 },
      { kind: 'dow', value: '0', weight: 1.0 },
      { kind: 'price', value: 'free_only', weight: 1.0 },
    ])
  })
})
