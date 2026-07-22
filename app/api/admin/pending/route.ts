import { NextRequest, NextResponse } from 'next/server'
import { listPendingEvents, getCityBySlug } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/server'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const citySlug = req.nextUrl.searchParams.get('city')
  if (!citySlug) return NextResponse.json({ error: 'city query param is required' }, { status: 400 })
  const city = await getCityBySlug(citySlug)
  if (!city) return NextResponse.json({ error: 'Unknown city' }, { status: 404 })

  const pending = await listPendingEvents(city.id)
  return NextResponse.json({ pending })
}
