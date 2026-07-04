import { describe, it, expect } from 'vitest'
import { normalizeTitle, normalizeVenue } from './normalize'

describe('normalizeVenue', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeVenue("Antone's  Nightclub!")).toBe('antones nightclub')
  })
  it('returns null for null/empty', () => {
    expect(normalizeVenue(null)).toBeNull()
    expect(normalizeVenue('   ')).toBeNull()
  })
})

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('Live Music: The Black Angels!')).toBe('the black angels')
  })
  it('strips a leading "X presents" promoter prefix', () => {
    expect(normalizeTitle('C3 Presents The Black Angels')).toBe('the black angels')
  })
  it('strips a trailing "live at <venue>" suffix', () => {
    expect(normalizeTitle('The Black Angels Live at Mohawk')).toBe('the black angels')
  })
  it('strips the venue name out of the title when given', () => {
    expect(normalizeTitle("The Black Angels at Antone's", "Antone's")).toBe('the black angels')
  })
  it('is stable — normalizing an already-normalized title is a no-op', () => {
    const once = normalizeTitle('C3 Presents The Black Angels Live at Mohawk')
    expect(normalizeTitle(once)).toBe(once)
  })
})
