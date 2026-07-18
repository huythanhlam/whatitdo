import { describe, it, expect } from 'vitest'
import { sanitizeNext, destForIntent, toIntent } from './nextParam'

describe('sanitizeNext', () => {
  it('accepts a same-origin path, preserving query + fragment', () => {
    expect(sanitizeNext('/austin?when=weekend#events')).toBe('/austin?when=weekend#events')
    expect(sanitizeNext('/austin#events')).toBe('/austin#events')
  })

  it('rejects open-redirect vectors', () => {
    expect(sanitizeNext('//evil.com')).toBeNull()
    expect(sanitizeNext('/\\evil.com')).toBeNull()
    expect(sanitizeNext('https://evil.com')).toBeNull()
    expect(sanitizeNext('javascript:alert(1)')).toBeNull()
    expect(sanitizeNext('austin')).toBeNull()
  })

  it('rejects missing/empty values', () => {
    expect(sanitizeNext(undefined)).toBeNull()
    expect(sanitizeNext(null)).toBeNull()
    expect(sanitizeNext('')).toBeNull()
  })

  it('takes the first value when given an array', () => {
    expect(sanitizeNext(['/austin', '/dallas'])).toBe('/austin')
  })
})

describe('toIntent', () => {
  it('defaults unknown values to browse', () => {
    expect(toIntent('nonsense')).toBe('browse')
    expect(toIntent(undefined)).toBe('browse')
    expect(toIntent('weekend')).toBe('weekend')
    expect(toIntent('category')).toBe('category')
  })
})

describe('destForIntent', () => {
  it('maps each intent to the right filtered list URL', () => {
    expect(destForIntent('/austin', 'browse')).toBe('/austin#events')
    expect(destForIntent('/austin', 'weekend')).toBe('/austin?when=weekend#events')
    expect(destForIntent('/austin', 'category', 'music')).toBe('/austin?category=music#events')
  })

  it('falls back to browse when category is missing', () => {
    expect(destForIntent('/austin', 'category')).toBe('/austin#events')
  })
})
