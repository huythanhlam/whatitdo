import { describe, it, expect } from 'vitest'
import { PARSERS } from './registry'
import { getPgliteDb } from '@/lib/db/pglite'

describe('parser registry', () => {
  it('registers a parser for every seeded source parser value', async () => {
    const db = await getPgliteDb()
    const rows = await db.query<{ parser: string }>(`SELECT DISTINCT parser FROM sources`)
    expect(rows.length).toBeGreaterThan(0)
    for (const { parser } of rows) {
      expect(PARSERS[parser], `missing parser: ${parser}`).toBeDefined()
      expect(typeof PARSERS[parser].fetch).toBe('function')
      expect(typeof PARSERS[parser].available).toBe('function')
    }
  })
})
