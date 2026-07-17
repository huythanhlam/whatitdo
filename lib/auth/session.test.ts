import { describe, it, expect } from 'vitest'
import {
  signWid,
  parseWid,
  newAnonId,
  hasActor,
  newSessionId,
  newAuthToken,
  sidCookieOptions,
  clearSidCookieOptions,
  SID_MAX_AGE_SECONDS,
} from './session'

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

describe('session ids & auth tokens', () => {
  it('mints 256-bit hex, distinct each time', () => {
    const a = newSessionId()
    const b = newSessionId()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
    expect(newAuthToken()).toMatch(/^[0-9a-f]{64}$/)
    expect(newAuthToken()).not.toBe(newAuthToken())
  })
})

describe('sid cookie options', () => {
  it('is httpOnly, lax, path=/ with the 90-day max-age', () => {
    const o = sidCookieOptions()
    expect(o.httpOnly).toBe(true)
    expect(o.sameSite).toBe('lax')
    expect(o.path).toBe('/')
    expect(o.maxAge).toBe(SID_MAX_AGE_SECONDS)
  })

  it('clears with maxAge 0', () => {
    expect(clearSidCookieOptions().maxAge).toBe(0)
  })
})
