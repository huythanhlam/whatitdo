import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const categories = searchParams.getAll('category')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = 24
  const offset = (page - 1) * limit

  const supabase = await createClient()

  // Get event IDs matching category filter first
  let filteredIds: string[] | null = null
  if (categories.length > 0) {
    const { data: catData } = await supabase
      .from('categories')
      .select('id')
      .in('slug', categories)
    const catIds = (catData ?? []).map(c => c.id)

    if (catIds.length > 0) {
      const { data: eventIds } = await supabase
        .from('event_categories')
        .select('event_id')
        .in('category_id', catIds)
      filteredIds = [...new Set((eventIds ?? []).map(r => r.event_id))]
    }
  }

  let query = supabase
    .from('events')
    .select(`
      id, title, description, start_time, end_time, venue_name, venue_address,
      image_url, ticket_url, source, is_free, price_min, price_max,
      event_categories(categories(id, slug, name, color)),
      featured_listings(id, ad_label, starts_at, ends_at)
    `)
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.ilike('title', `%${q}%`)
  }

  if (filteredIds !== null) {
    if (filteredIds.length === 0) {
      return NextResponse.json({ events: [], page, limit })
    }
    query = query.in('id', filteredIds)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = new Date().toISOString()
  const events = (data ?? []).map((event: Record<string, unknown>) => {
    const featuredList = event.featured_listings as { starts_at: string; ends_at: string; ad_label: string }[] | null
    const activeFeatured = (featuredList ?? []).find(
      f => f.starts_at <= now && f.ends_at >= now
    )
    const catJoins = event.event_categories as { categories: { id: number; slug: string; name: string; color: string } | null }[] | null
    return {
      ...event,
      categories: (catJoins ?? []).map(ec => ec.categories).filter(Boolean),
      is_featured: !!activeFeatured,
      featured_label: activeFeatured?.ad_label ?? null,
      event_categories: undefined,
      featured_listings: undefined,
    }
  })

  return NextResponse.json({ events, page, limit })
}
