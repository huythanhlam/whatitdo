import { createClient as createSbServer } from '@/lib/supabase/server'
import { createClient as createSbAdmin } from '@supabase/supabase-js'
import { getPglite } from './pglite'
import type { RawEvent } from '@/lib/scrapers/types'

// Returns true when no Supabase project is configured — the app then runs
// against an embedded local Postgres (PGlite) so it works with zero credentials.
export function isLocal(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY
}

function uuid(): string {
  return crypto.randomUUID()
}

type EnrichedEvent = Record<string, unknown> & {
  id: string
  categories: { id: number; slug: string; name: string; color: string }[]
  is_featured: boolean
  featured_label: string | null
}

function enrichRow(row: Record<string, unknown>, nowIso: string): EnrichedEvent {
  const cats = (row.categories as EnrichedEvent['categories']) ?? []
  const featuredList = (row.featured_listings as { starts_at: string; ends_at: string; ad_label: string }[] | null) ?? []
  const activeFeatured = featuredList.find(f => f.starts_at <= nowIso && f.ends_at >= nowIso)
  const { featured_listings, ...rest } = row
  void featured_listings
  return {
    ...rest,
    id: row.id as string,
    categories: cats,
    is_featured: !!activeFeatured,
    featured_label: activeFeatured?.ad_label ?? null,
  }
}

// ---------------------------------------------------------------------------
// listEvents
// ---------------------------------------------------------------------------
export async function listEvents(opts: {
  q?: string
  categories?: string[]
  from?: string
  to?: string
  limit: number
  offset: number
}): Promise<EnrichedEvent[]> {
  const nowIso = new Date().toISOString()
  const fromIso = opts.from && opts.from > nowIso ? opts.from : nowIso

  if (isLocal()) {
    const db = await getPglite()
    const params: unknown[] = [fromIso]
    let where = 'e.start_time >= $1'

    if (opts.to) {
      params.push(opts.to)
      where += ` AND e.start_time <= $${params.length}`
    }
    if (opts.q) {
      params.push(`%${opts.q}%`)
      where += ` AND e.title ILIKE $${params.length}`
    }
    if (opts.categories && opts.categories.length > 0) {
      params.push(opts.categories)
      where += ` AND e.id IN (
        SELECT ec.event_id FROM event_categories ec
        JOIN categories c ON c.id = ec.category_id
        WHERE c.slug = ANY($${params.length}))`
    }
    params.push(opts.limit)
    params.push(opts.offset)

    const sql = `
      SELECT e.*,
        COALESCE((
          SELECT json_agg(json_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'color', c.color))
          FROM event_categories ec JOIN categories c ON c.id = ec.category_id
          WHERE ec.event_id = e.id
        ), '[]'::json) AS categories,
        COALESCE((
          SELECT json_agg(json_build_object('starts_at', f.starts_at, 'ends_at', f.ends_at, 'ad_label', f.ad_label))
          FROM featured_listings f WHERE f.event_id = e.id
        ), '[]'::json) AS featured_listings
      FROM events e
      WHERE ${where}
      ORDER BY e.start_time ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`

    const res = await db.query<Record<string, unknown>>(sql, params)
    return res.rows.map(r => enrichRow(r, nowIso))
  }

  // Supabase path
  const supabase = await createSbServer()
  let filteredIds: string[] | null = null
  if (opts.categories && opts.categories.length > 0) {
    const { data: catData } = await supabase.from('categories').select('id').in('slug', opts.categories)
    const catIds = (catData ?? []).map(c => c.id)
    if (catIds.length > 0) {
      const { data: eventIds } = await supabase.from('event_categories').select('event_id').in('category_id', catIds)
      filteredIds = [...new Set((eventIds ?? []).map(r => r.event_id))]
    } else {
      filteredIds = []
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
    .gte('start_time', fromIso)
    .order('start_time', { ascending: true })
    .range(opts.offset, opts.offset + opts.limit - 1)

  if (opts.to) query = query.lte('start_time', opts.to)
  if (opts.q) query = query.ilike('title', `%${opts.q}%`)
  if (filteredIds !== null) {
    if (filteredIds.length === 0) return []
    query = query.in('id', filteredIds)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data ?? []).map((event: Record<string, unknown>) => {
    const catJoins = event.event_categories as { categories: EnrichedEvent['categories'][number] | null }[] | null
    const normalized = { ...event, categories: (catJoins ?? []).map(ec => ec.categories).filter(Boolean) }
    delete (normalized as Record<string, unknown>).event_categories
    return enrichRow(normalized, nowIso)
  })
}

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------
export async function getEvent(id: string): Promise<EnrichedEvent | null> {
  const nowIso = new Date().toISOString()
  if (isLocal()) {
    const db = await getPglite()
    const res = await db.query<Record<string, unknown>>(
      `SELECT e.*,
        COALESCE((
          SELECT json_agg(json_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'color', c.color))
          FROM event_categories ec JOIN categories c ON c.id = ec.category_id
          WHERE ec.event_id = e.id
        ), '[]'::json) AS categories
      FROM events e WHERE e.id = $1`,
      [id]
    )
    if (res.rows.length === 0) return null
    return enrichRow(res.rows[0], nowIso)
  }

  const supabase = await createSbServer()
  const { data, error } = await supabase
    .from('events')
    .select(`*, event_categories(categories(id, slug, name, color))`)
    .eq('id', id)
    .single()
  if (error || !data) return null
  const catJoins = data.event_categories as { categories: EnrichedEvent['categories'][number] | null }[] | null
  const normalized = { ...data, categories: (catJoins ?? []).map(ec => ec.categories).filter(Boolean) }
  delete (normalized as Record<string, unknown>).event_categories
  return enrichRow(normalized, nowIso)
}

// ---------------------------------------------------------------------------
// Ingestion helpers
// ---------------------------------------------------------------------------
export async function getCategoryIdBySlug(): Promise<Record<string, number>> {
  if (isLocal()) {
    const db = await getPglite()
    const res = await db.query<{ id: number; slug: string }>(`SELECT id, slug FROM categories`)
    return Object.fromEntries(res.rows.map(c => [c.slug, c.id]))
  }
  const supabase = sbAdmin()
  const { data } = await supabase.from('categories').select('id, slug')
  return Object.fromEntries((data ?? []).map(c => [c.slug, c.id]))
}

export async function upsertEvent(raw: RawEvent): Promise<string | null> {
  if (isLocal()) {
    const db = await getPglite()
    const id = uuid()
    const res = await db.query<{ id: string }>(
      `INSERT INTO events (id, title, description, start_time, end_time, venue_name,
        venue_address, image_url, ticket_url, source, source_id, is_free, price_min, price_max, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
       ON CONFLICT (source, source_id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description,
         start_time = EXCLUDED.start_time, updated_at = NOW()
       RETURNING id`,
      [id, raw.title, raw.description, raw.start_time, raw.end_time, raw.venue_name,
       raw.venue_address, raw.image_url, raw.ticket_url, raw.source, raw.source_id,
       raw.is_free, raw.price_min, raw.price_max]
    )
    return res.rows[0]?.id ?? null
  }

  const supabase = sbAdmin()
  const { data, error } = await supabase
    .from('events')
    .upsert({ ...raw, updated_at: new Date().toISOString() }, { onConflict: 'source,source_id' })
    .select('id')
    .single()
  if (error || !data) return null
  return data.id
}

export async function setEventCategories(eventId: string, categoryIds: number[]): Promise<void> {
  if (categoryIds.length === 0) return
  if (isLocal()) {
    const db = await getPglite()
    for (const cid of categoryIds) {
      await db.query(
        `INSERT INTO event_categories (event_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [eventId, cid]
      )
    }
    return
  }
  const supabase = sbAdmin()
  await supabase
    .from('event_categories')
    .upsert(categoryIds.map(category_id => ({ event_id: eventId, category_id })), { onConflict: 'event_id,category_id' })
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
export async function addSubscription(sub: {
  email: string
  frequency: string
  category_slugs: string[]
}): Promise<string | null> {
  if (isLocal()) {
    const db = await getPglite()
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const res = await db.query<{ token: string }>(
      `INSERT INTO subscriptions (id, email, frequency, category_slugs, token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET frequency = EXCLUDED.frequency,
         category_slugs = EXCLUDED.category_slugs
       RETURNING token`,
      [uuid(), sub.email, sub.frequency, sub.category_slugs, token]
    )
    return res.rows[0]?.token ?? null
  }
  const supabase = sbAdmin()
  const { data, error } = await supabase
    .from('subscriptions')
    .upsert(sub, { onConflict: 'email' })
    .select('token')
    .single()
  if (error || !data) return null
  return data.token
}

export async function removeSubscription(token: string): Promise<void> {
  if (isLocal()) {
    const db = await getPglite()
    await db.query(`DELETE FROM subscriptions WHERE token = $1`, [token])
    return
  }
  const supabase = sbAdmin()
  await supabase.from('subscriptions').delete().eq('token', token)
}

export async function listSubscriptions(frequency: string): Promise<
  { email: string; token: string; category_slugs: string[] }[]
> {
  if (isLocal()) {
    const db = await getPglite()
    const res = await db.query<{ email: string; token: string; category_slugs: string[] }>(
      `SELECT email, token, category_slugs FROM subscriptions WHERE frequency = $1`,
      [frequency]
    )
    return res.rows
  }
  const supabase = sbAdmin()
  const { data } = await supabase.from('subscriptions').select('email, token, category_slugs').eq('frequency', frequency)
  return data ?? []
}

// ---------------------------------------------------------------------------
// Featured listings
// ---------------------------------------------------------------------------
export async function addFeatured(f: {
  event_id: string
  starts_at: string
  ends_at: string
  ad_label: string
}): Promise<Record<string, unknown> | null> {
  if (isLocal()) {
    const db = await getPglite()
    const res = await db.query<Record<string, unknown>>(
      `INSERT INTO featured_listings (id, event_id, starts_at, ends_at, ad_label)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [uuid(), f.event_id, f.starts_at, f.ends_at, f.ad_label]
    )
    return res.rows[0] ?? null
  }
  const supabase = sbAdmin()
  const { data, error } = await supabase.from('featured_listings').insert(f).select().single()
  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------
// Digest helper
// ---------------------------------------------------------------------------
export async function getEventsBetween(startIso: string, endIso: string): Promise<EnrichedEvent[]> {
  if (isLocal()) {
    const db = await getPglite()
    const res = await db.query<Record<string, unknown>>(
      `SELECT e.*,
        COALESCE((
          SELECT json_agg(json_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'color', c.color))
          FROM event_categories ec JOIN categories c ON c.id = ec.category_id
          WHERE ec.event_id = e.id
        ), '[]'::json) AS categories
      FROM events e WHERE e.start_time >= $1 AND e.start_time <= $2
      ORDER BY e.start_time ASC`,
      [startIso, endIso]
    )
    return res.rows.map(r => enrichRow(r, new Date().toISOString()))
  }
  const supabase = sbAdmin()
  const { data } = await supabase
    .from('events')
    .select(`*, event_categories(categories(id, slug, name, color))`)
    .gte('start_time', startIso)
    .lte('start_time', endIso)
    .order('start_time', { ascending: true })
  return (data ?? []).map((event: Record<string, unknown>) => {
    const catJoins = event.event_categories as { categories: EnrichedEvent['categories'][number] | null }[] | null
    const normalized = { ...event, categories: (catJoins ?? []).map(ec => ec.categories).filter(Boolean) }
    delete (normalized as Record<string, unknown>).event_categories
    return enrichRow(normalized, new Date().toISOString())
  })
}

function sbAdmin() {
  return createSbAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
