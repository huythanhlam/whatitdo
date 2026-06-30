import { NextRequest, NextResponse } from 'next/server'
import { addFeatured, isLocal } from '@/lib/db'

export async function POST(req: NextRequest) {
  if (process.env.CRON_SECRET || !isLocal()) {
    const authHeader = req.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const body = await req.json()
  const { event_id, starts_at, ends_at, ad_label = 'Featured' } = body

  if (!event_id || !starts_at || !ends_at) {
    return NextResponse.json({ error: 'event_id, starts_at, ends_at are required' }, { status: 400 })
  }

  try {
    const data = await addFeatured({ event_id, starts_at, ends_at, ad_label })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
