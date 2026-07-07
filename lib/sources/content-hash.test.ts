import { describe, it, expect } from 'vitest'
import { hashPageText } from './content-hash'

describe('hashPageText', () => {
  it('is stable and deterministic for the same input', () => {
    expect(hashPageText('hello world')).toBe(hashPageText('hello world'))
  })
  it('ignores leading/trailing whitespace and collapses runs', () => {
    expect(hashPageText('  a   b\n\nc ')).toBe(hashPageText('a b\nc'))
  })
  it('differs when meaningful content changes', () => {
    expect(hashPageText('event A tonight')).not.toBe(hashPageText('event B tonight'))
  })
  it('returns a 64-char hex sha256 digest', () => {
    expect(hashPageText('x')).toMatch(/^[0-9a-f]{64}$/)
  })
})
