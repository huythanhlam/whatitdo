import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireCronAuth } from './auth'

function reqWithAuth(header?: string): NextRequest {
  return new NextRequest('http://localhost/api/ingest', {
    headers: header ? { authorization: header } : {},
  })
}

describe('requireCronAuth', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is open outside production regardless of CRON_SECRET', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CRON_SECRET', '')
    expect(requireCronAuth(reqWithAuth())).toBeNull()
  })

  describe('in production', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production')
    })

    it('refuses (503) when CRON_SECRET is unset — never runs wide open', async () => {
      vi.stubEnv('CRON_SECRET', '')
      const res = requireCronAuth(reqWithAuth('Bearer anything'))
      expect(res?.status).toBe(503)
    })

    it('rejects (401) a missing or wrong bearer token', async () => {
      vi.stubEnv('CRON_SECRET', 'correct-horse-battery-staple')
      expect(requireCronAuth(reqWithAuth())?.status).toBe(401)
      expect(requireCronAuth(reqWithAuth('Bearer wrong'))?.status).toBe(401)
      // A guess that is a strict prefix of the real secret must not be
      // treated specially — this is the case a non-constant-time `!==`
      // compare would still reject correctly on, but where the fix matters
      // is response *timing*, not the yes/no outcome, so this just pins the
      // correctness contract while lib/auth.ts's comment documents why the
      // comparison itself was changed.
      expect(requireCronAuth(reqWithAuth('Bearer correct-horse'))?.status).toBe(401)
    })

    it('allows the exact configured bearer token through', () => {
      vi.stubEnv('CRON_SECRET', 'correct-horse-battery-staple')
      expect(requireCronAuth(reqWithAuth('Bearer correct-horse-battery-staple'))).toBeNull()
    })
  })
})
