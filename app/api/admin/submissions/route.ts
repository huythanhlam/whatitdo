import { NextRequest, NextResponse } from 'next/server'
import { listPendingEvents, setEventStatus } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Admin moderation queue for user submissions (Phase 2C). API-only for v1 —
// accounts are post-v1 (PRODUCT-SPEC §5), so this reuses the same fail-closed
// bearer auth as /api/admin/health rather than a browser-authenticated UI.
//
//   GET  /api/admin/submissions           → the pending queue
//   POST /api/admin/submissions           → { event_id, action: 'approve'|'reject' }
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  const pending = await listPendingEvents(200)
  return NextResponse.json({ count: pending.length, pending })
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  let body: { event_id?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with event_id and action' }, { status: 400 })
  }

  const eventId = typeof body.event_id === 'string' ? body.event_id : ''
  const action = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : null
  if (!eventId || !action) {
    return NextResponse.json({ error: 'event_id and action ("approve"|"reject") are required' }, { status: 400 })
  }

  try {
    await setEventStatus(eventId, action)
    return NextResponse.json({ ok: true, event_id: eventId, status: action })
  } catch (e) {
    console.error('Moderation action failed:', e)
    return NextResponse.json({ error: 'Could not update submission' }, { status: 500 })
  }
}
