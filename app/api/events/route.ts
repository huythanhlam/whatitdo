import { NextRequest, NextResponse } from 'next/server'
import { listEvents } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const categories = searchParams.getAll('category')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = 24
  const offset = (page - 1) * limit

  try {
    const events = await listEvents({ q, categories, limit, offset })
    return NextResponse.json({ events, page, limit })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
