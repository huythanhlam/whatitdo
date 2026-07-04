import type { Db } from './driver'
import { getPgDb } from './pg'
import { getPgliteDb } from './pglite'
import type { RawEvent } from '@/lib/scrapers/types'

// Returns true when no direct Postgres connection is configured — the app then
// runs against an embedded local Postgres (PGlite) so it works with zero
// credentials. `DATABASE_URL` (the Supabase Supavisor pooler) selects prod.
export function isLocal(): boolean {
  return !process.env.DATABASE_URL
}

// Pick the driver once. Both speak the same SQL dialect, so every query below is
// written exactly once — no per-function branch, no PostgREST query-builder.
function getDb(): Promise<Db> {
  return isLocal() ? getPgliteDb() : Promise.resolve(getPgDb())
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

// A correlated subquery that aggregates an event's categories into a JSON array.
// Written once; reused by every read path.
const CATEGORIES_JSON = `COALESCE((
  SELECT json_agg(json_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'color', c.color))
  FROM event_categories ec JOIN categories c ON c.id = ec.category_id
  WHERE ec.event_id = e.id
), '[]'::json) AS categories`

const FEATURED_JSON = `COALESCE((
  SELECT json_agg(json_build_object('starts_at', f.starts_at, 'ends_at', f.ends_at, 'ad_label', f.ad_label))
  FROM featured_listings f WHERE f.event_id = e.id
), '[]'::json) AS featured_listings`

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
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const fromIso = opts.from && opts.from > nowIso ? opts.from : nowIso

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

  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON}, ${FEATURED_JSON}
     FROM events e
     WHERE ${where}
     ORDER BY e.start_time ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return rows.map(r => enrichRow(r, nowIso))
}

// ---------------------------------------------------------------------------
// countEvents — total matching the same filters (for "showing X of N")
// ---------------------------------------------------------------------------
export async function countEvents(opts: {
  q?: string
  categories?: string[]
  from?: string
  to?: string
}): Promise<number> {
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const fromIso = opts.from && opts.from > nowIso ? opts.from : nowIso

  const params: unknown[] = [fromIso]
  let where = 'e.start_time >= $1'
  if (opts.to) { params.push(opts.to); where += ` AND e.start_time <= $${params.length}` }
  if (opts.q) { params.push(`%${opts.q}%`); where += ` AND e.title ILIKE $${params.length}` }
  if (opts.categories && opts.categories.length > 0) {
    params.push(opts.categories)
    where += ` AND e.id IN (SELECT ec.event_id FROM event_categories ec
      JOIN categories c ON c.id = ec.category_id WHERE c.slug = ANY($${params.length}))`
  }
  const rows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM events e WHERE ${where}`,
    params
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------
export async function getEvent(id: string): Promise<EnrichedEvent | null> {
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON} FROM events e WHERE e.id = $1`,
    [id]
  )
  if (rows.length === 0) return null
  return enrichRow(rows[0], nowIso)
}

// ---------------------------------------------------------------------------
// Ingestion helpers
// ---------------------------------------------------------------------------
export async function getCategoryIdBySlug(): Promise<Record<string, number>> {
  const db = await getDb()
  const rows = await db.query<{ id: number; slug: string }>(`SELECT id, slug FROM categories`)
  return Object.fromEntries(rows.map(c => [c.slug, c.id]))
}

export async function upsertEvent(raw: RawEvent): Promise<string | null> {
  const db = await getDb()
  const rows = await db.query<{ id: string }>(
    `INSERT INTO events (title, description, start_time, end_time, venue_name,
       venue_address, image_url, ticket_url, source, source_id, is_free, price_min, price_max, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (source, source_id) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description,
       start_time = EXCLUDED.start_time, updated_at = NOW()
     RETURNING id`,
    [raw.title, raw.description, raw.start_time, raw.end_time, raw.venue_name,
     raw.venue_address, raw.image_url, raw.ticket_url, raw.source, raw.source_id,
     raw.is_free, raw.price_min, raw.price_max]
  )
  return rows[0]?.id ?? null
}

export async function setEventCategories(eventId: string, categoryIds: number[]): Promise<void> {
  if (categoryIds.length === 0) return
  const db = await getDb()
  for (const cid of categoryIds) {
    await db.query(
      `INSERT INTO event_categories (event_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [eventId, cid]
    )
  }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
export async function addSubscription(sub: {
  email: string
  frequency: string
  category_slugs: string[]
}): Promise<string | null> {
  const db = await getDb()
  // token is generated by the column default (pgcrypto in Postgres, a shim in
  // PGlite); RETURNING hands it back for the confirmation/unsubscribe links.
  const rows = await db.query<{ token: string }>(
    `INSERT INTO subscriptions (email, frequency, category_slugs)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET frequency = EXCLUDED.frequency,
       category_slugs = EXCLUDED.category_slugs
     RETURNING token`,
    [sub.email, sub.frequency, sub.category_slugs]
  )
  return rows[0]?.token ?? null
}

export async function removeSubscription(token: string): Promise<void> {
  const db = await getDb()
  await db.query(`DELETE FROM subscriptions WHERE token = $1`, [token])
}

export async function listSubscriptions(frequency: string): Promise<
  { email: string; token: string; category_slugs: string[] }[]
> {
  const db = await getDb()
  return db.query<{ email: string; token: string; category_slugs: string[] }>(
    `SELECT email, token, category_slugs FROM subscriptions WHERE frequency = $1`,
    [frequency]
  )
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
  const db = await getDb()
  const rows = await db.query<Record<string, unknown>>(
    `INSERT INTO featured_listings (event_id, starts_at, ends_at, ad_label)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [f.event_id, f.starts_at, f.ends_at, f.ad_label]
  )
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Digest helper
// ---------------------------------------------------------------------------
export async function getEventsBetween(startIso: string, endIso: string): Promise<EnrichedEvent[]> {
  const db = await getDb()
  const nowIso = new Date().toISOString()
  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.*, ${CATEGORIES_JSON}
     FROM events e WHERE e.start_time >= $1 AND e.start_time <= $2
     ORDER BY e.start_time ASC`,
    [startIso, endIso]
  )
  return rows.map(r => enrichRow(r, nowIso))
}
