import { NextRequest, NextResponse } from 'next/server'
import { approveEvent, rejectEvent } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  let body: { action?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON with an "action" field' }, { status: 400 })
  }

  if (body.action === 'approve') {
    await approveEvent(id)
  } else if (body.action === 'reject') {
    await rejectEvent(id)
  } else {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
