import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

// Fail-closed bearer auth for mutation / cron endpoints (ingest, import,
// featured, email digest).
//
//   - Development (NODE_ENV !== 'production'): open, so the zero-config local
//     flow in the README (`curl -X POST /api/ingest`) keeps working.
//   - Production: CRON_SECRET must be set AND the request must present it as
//     `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is unset the
//     endpoint refuses (503) instead of silently running wide open — which is
//     how these routes behaved before. Vercel Cron automatically sends this
//     header when CRON_SECRET is configured, so scheduled runs keep working.
//
// Returns an error response when the request must be rejected, or null when it
// is authorized to proceed.
export function requireCronAuth(req: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null

  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'This endpoint is not configured (CRON_SECRET is unset).' },
      { status: 503 }
    )
  }

  const presented = req.headers.get('authorization') ?? ''
  if (!constantTimeEqual(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}

// A plain `!==` short-circuits on the first mismatching byte, so response
// time leaks how many leading characters of CRON_SECRET a guess got right —
// a timing side channel against a single, shared, high-privilege secret that
// guards every mutation/cron/admin route. timingSafeEqual requires equal
// lengths, so pad both sides to a fixed size first (this leaks only that the
// unpadded lengths differ up to that size, not which byte, which is the
// standard mitigation for comparing variable-length attacker input).
function constantTimeEqual(a: string, b: string): boolean {
  const size = Math.max(a.length, b.length, 1)
  const bufA = Buffer.alloc(size)
  const bufB = Buffer.alloc(size)
  bufA.write(a)
  bufB.write(b)
  return timingSafeEqual(bufA, bufB) && a.length === b.length
}
