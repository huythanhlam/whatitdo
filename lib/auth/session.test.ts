import { describe, it, expect } from 'vitest'
import { signWid, parseWid, newAnonId, hasActor } from './session'

describe('wid cookie signing', () => {
  it('round-trips a minted id', () => {
    const id = newAnonId()
    expect(parseWid(signWid(id))).toBe(id)
  })

  it('rejects a tampered id (signature no longer matches)', () => {
    const id = newAnonId()
    const value = signWid(id)
    const tampered = value.replace(/^./, c => (c === 'a' ? 'b' : 'a'))
    expect(parseWid(tampered)).toBeNull()
  })

  it('rejects a swapped signature', () => {
    const a = signWid(newAnonId())
    const b = signWid(newAnonId())
    const forged = `${a.split('.')[0]}.${b.split('.')[1]}`
    expect(parseWid(forged)).toBeNull()
  })

  it('rejects empty, unsigned, and malformed values', () => {
    expect(parseWid(null)).toBeNull()
    expect(parseWid('')).toBeNull()
    expect(parseWid('just-an-id-no-sig')).toBeNull()
    expect(parseWid('.sigonly')).toBeNull()
  })

  it('mints distinct ids', () => {
    expect(newAnonId()).not.toBe(newAnonId())
  })
})

describe('hasActor', () => {
  it('is true when either identity is present', () => {
    expect(hasActor({ userId: null, anonId: 'x' })).toBe(true)
    expect(hasActor({ userId: 'u', anonId: null })).toBe(true)
    expect(hasActor({ userId: null, anonId: null })).toBe(false)
  })
})
