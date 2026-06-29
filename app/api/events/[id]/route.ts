import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      event_categories(categories(id, slug, name, color))
    `)
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const catJoins = data.event_categories as { categories: unknown }[] | null
  return NextResponse.json({
    ...data,
    categories: (catJoins ?? []).map(ec => ec.categories).filter(Boolean),
    event_categories: undefined,
  })
}
