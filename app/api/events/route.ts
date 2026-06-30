import { NextRequest, NextResponse } from 'next/server'
import { listEvents } from '@/lib/db'
import { resolveDateRange } from '@/lib/dateRanges'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const categories = searchParams.getAll('category')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = 24
  const offset = (page - 1) * limit

  const range = resolveDateRange({
    when: searchParams.get('when'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
  })

  try {
    const events = await listEvents({
      q, categories, from: range.fromIso, to: range.toIso ?? undefined, limit, offset,
    })
    return NextResponse.json({ events, page, limit, range: range.label })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
