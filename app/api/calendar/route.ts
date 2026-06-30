import { NextRequest, NextResponse } from 'next/server'
import { listEvents } from '@/lib/db'
import { gridRangeIso } from '@/lib/calendar'

// Returns every event whose start falls within the visible month grid, so the
// calendar can bucket them by day client-side. `month` is 1-indexed in the URL.
// Search (`q`) and `category` filters are honored to match the rest of the app.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const year = parseInt(searchParams.get('year') ?? '', 10)
  const month = parseInt(searchParams.get('month') ?? '', 10) // 1-indexed

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'invalid year/month' }, { status: 400 })
  }

  const q = searchParams.get('q') ?? ''
  const categories = searchParams.getAll('category')
  const { fromIso, toIso } = gridRangeIso(year, month - 1)

  try {
    const events = await listEvents({ q, categories, from: fromIso, to: toIso, limit: 1000, offset: 0 })
    return NextResponse.json({ events, year, month })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
