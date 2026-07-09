import { NextRequest, NextResponse } from 'next/server'
import { listEvents, getCityBySlug } from '@/lib/db'
import { resolveDateRange } from '@/lib/dateRanges'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const citySlug = searchParams.get('city') ?? ''
  const city = citySlug ? await getCityBySlug(citySlug) : null
  if (!city || !city.enabled) return NextResponse.json({ error: 'A valid "city" query param is required' }, { status: 400 })

  const q = searchParams.get('q') ?? ''
  const categories = searchParams.getAll('category')
  const isFree = searchParams.get('isFree') === 'true'
  const parsedPage = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1
  const limit = 24
  const offset = (page - 1) * limit

  const range = resolveDateRange({
    when: searchParams.get('when'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
  })

  try {
    const events = await listEvents({
      cityId: city.id, q, categories, isFree, from: range.fromIso, to: range.toIso ?? undefined, limit, offset,
    })
    return NextResponse.json({ events, page, limit, range: range.label })
  } catch (e) {
    console.error('Failed to list events:', e)
    return NextResponse.json({ error: 'Could not load events' }, { status: 500 })
  }
}
