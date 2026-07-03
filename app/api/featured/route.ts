import { NextRequest, NextResponse } from 'next/server'
import { addFeatured } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const body = await req.json()
  const { event_id, starts_at, ends_at, ad_label = 'Featured' } = body

  if (!event_id || !starts_at || !ends_at) {
    return NextResponse.json({ error: 'event_id, starts_at, ends_at are required' }, { status: 400 })
  }

  try {
    const data = await addFeatured({ event_id, starts_at, ends_at, ad_label })
    return NextResponse.json(data)
  } catch (e) {
    console.error('Failed to create featured listing:', e)
    return NextResponse.json({ error: 'Could not create featured listing' }, { status: 500 })
  }
}
