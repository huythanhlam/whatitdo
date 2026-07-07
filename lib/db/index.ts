import type { Db } from './driver'
import { getPgDb } from './pg'
import { getPgliteDb } from './pglite'
import type { RawEvent } from '@/lib/sources/types'
import type { ExistingEvent, Candidate, FieldPatch } from '@/lib/dedup'

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

// Per-event provenance for the "also listed on …" UI: the distinct sources that
// contributed to this canonical event, with their source-specific links.
const SOURCES_JSON = `COALESCE((
  SELECT json_agg(json_build_object('source', s.source, 'url', s.url) ORDER BY s.source)
  FROM event_sources s WHERE s.event_id = e.id
), '[]'::json) AS sources`

// Full-text search over title + description + venue, matching the expression of
// the GIN index in migration 001 so it uses that index instead of a sequential
// ILIKE scan. websearch_to_tsquery accepts natural query syntax ("live music",
// quoted phrases, -exclusions) and is null-safe on empty input.
const FTS_MATCH = `to_tsvector('english',
  coalesce(e.title,'') || ' ' || coalesce(e.description,'') || ' ' || coalesce(e.venue_name,'')
) @@ websearch_to_tsquery('english', $PARAM)`

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
    params.push(opts.q)
    where += ` AND ${FTS_MATCH.replace('$PARAM', `$${params.length}`)}`
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
  if (opts.q) { params.push(opts.q); where += ` AND ${FTS_MATCH.replace('$PARAM', `$${params.length}`)}` }
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
    `SELECT e.*, ${CATEGORIES_JSON}, ${SOURCES_JSON} FROM events e WHERE e.id = $1`,
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

// Idempotency lookup: has this exact (source, external_id) already been mapped to
// a canonical event? Mirrors the old UNIQUE(source, source_id) fast-path so a
// daily re-ingest updates in place instead of re-running dedup.
export async function findEventBySource(source: string, externalId: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.query<{ event_id: string }>(
    `SELECT event_id FROM event_sources WHERE source = $1 AND external_id = $2`,
    [source, externalId]
  )
  return rows[0]?.event_id ?? null
}

// Blocking + scoring in one query (PRODUCT-SPEC §2.2.1–2.2.2): candidates share a
// city, start within ±2h, and either agree on venue or have a null venue; scored
// by pg_trgm title similarity. venueAgree = both venues present and equal.
export async function findDedupCandidates(opts: {
  cityId: number
  startTime: string
  titleNorm: string
  venueNorm: string | null
}): Promise<Candidate[]> {
  const db = await getDb()
  const rows = await db.query<{ id: string; sim: number; venue_agree: boolean }>(
    `SELECT e.id,
            similarity(e.title_norm, $1) AS sim,
            (e.venue_norm IS NOT NULL AND $2::text IS NOT NULL AND e.venue_norm = $2) AS venue_agree
     FROM events e
     WHERE e.city_id = $3
       AND e.start_time BETWEEN ($4)::timestamptz - interval '2 hours'
                            AND ($4)::timestamptz + interval '2 hours'
       AND (e.venue_norm = $2 OR e.venue_norm IS NULL OR $2::text IS NULL)
       AND e.title_norm IS NOT NULL
     ORDER BY sim DESC
     LIMIT 10`,
    [opts.titleNorm, opts.venueNorm, opts.cityId, opts.startTime]
  )
  return rows.map(r => ({ id: r.id, sim: Number(r.sim), venueAgree: !!r.venue_agree }))
}

// Insert a brand-new canonical event. Caller supplies the normalized keys.
export async function insertEvent(
  raw: RawEvent,
  keys: { cityId: number; titleNorm: string; venueNorm: string | null }
): Promise<string> {
  const db = await getDb()
  const rows = await db.query<{ id: string }>(
    `INSERT INTO events (title, description, start_time, end_time, venue_name,
       venue_address, image_url, ticket_url, source, source_id, is_free,
       price_min, price_max, city_id, title_norm, venue_norm, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
     RETURNING id`,
    [raw.title, raw.description, raw.start_time, raw.end_time, raw.venue_name,
     raw.venue_address, raw.image_url, raw.ticket_url, raw.source, raw.source_id,
     raw.is_free, raw.price_min, raw.price_max, keys.cityId, keys.titleNorm, keys.venueNorm]
  )
  return rows[0].id
}

// Fetch the mergeable columns of a canonical event for mergeFields().
export async function getEventRow(id: string): Promise<ExistingEvent | null> {
  const db = await getDb()
  const rows = await db.query<ExistingEvent>(
    `SELECT source, source_id, title, venue_norm, description, image_url,
            venue_name, venue_address, end_time, ticket_url, is_free, price_min, price_max
     FROM events WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

// Apply a whitelisted field patch. Column names come only from FieldPatch keys,
// so the dynamic SQL is injection-safe (values are parameterized). PATCHABLE must
// stay a superset of FieldPatch's keys — venue_norm included, so a filled venue's
// normalized key is not silently dropped.
const PATCHABLE = new Set([
  'title', 'title_norm', 'source', 'source_id', 'description', 'image_url',
  'venue_name', 'venue_norm', 'venue_address', 'end_time', 'ticket_url',
  'is_free', 'price_min', 'price_max',
])
export async function updateEventFields(id: string, patch: FieldPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => PATCHABLE.has(k))
  if (entries.length === 0) return
  const db = await getDb()
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`)
  const values = entries.map(([, v]) => v)
  await db.query(
    `UPDATE events SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...values]
  )
}

// Write/refresh the provenance row. ON CONFLICT keeps the pipeline idempotent
// across daily re-ingests of the same (source, external_id).
export async function recordProvenance(p: {
  eventId: string
  source: string
  externalId: string
  url: string | null
  raw: unknown
}): Promise<void> {
  const db = await getDb()
  await db.query(
    `INSERT INTO event_sources (event_id, source, external_id, url, raw, ingested_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (source, external_id) DO UPDATE SET
       event_id = EXCLUDED.event_id, url = EXCLUDED.url,
       raw = EXCLUDED.raw, ingested_at = NOW()`,
    [p.eventId, p.source, p.externalId, p.url, JSON.stringify(p.raw)]
  )
}

// Provenance for the UI ("also listed on …").
export async function getEventSources(
  eventId: string
): Promise<{ source: string; external_id: string; url: string | null }[]> {
  const db = await getDb()
  return db.query(
    `SELECT source, external_id, url FROM event_sources WHERE event_id = $1 ORDER BY source ASC`,
    [eventId]
  )
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
// Source runs — the observability ledger (one row per source per ingest run)
// ---------------------------------------------------------------------------
export type SourceRun = {
  id: number
  source: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'error' | 'skipped'
  events_found: number
  events_upserted: number
  events_rejected: number
  gemini_requests: number
  error: string | null
}

// Open a run (status 'running'); returns its id so the orchestrator can close
// it with the final counts once the source finishes.
export async function startSourceRun(source: string): Promise<number> {
  const db = await getDb()
  const rows = await db.query<{ id: number }>(
    `INSERT INTO source_runs (source, status) VALUES ($1, 'running') RETURNING id`,
    [source]
  )
  return rows[0].id
}

export async function finishSourceRun(
  id: number,
  fields: {
    status: 'ok' | 'error' | 'skipped'
    events_found?: number
    events_upserted?: number
    events_rejected?: number
    gemini_requests?: number
    error?: string | null
  }
): Promise<void> {
  const db = await getDb()
  await db.query(
    `UPDATE source_runs SET
       finished_at = NOW(), status = $2,
       events_found = $3, events_upserted = $4, events_rejected = $5,
       gemini_requests = $6, error = $7
     WHERE id = $1`,
    [id, fields.status, fields.events_found ?? 0, fields.events_upserted ?? 0,
     fields.events_rejected ?? 0, fields.gemini_requests ?? 0, fields.error ?? null]
  )
}

// The most recent `perSource` runs for each source, newest first — the raw
// material for /api/admin/health's staleness check.
export async function recentSourceRuns(perSource: number): Promise<SourceRun[]> {
  const db = await getDb()
  return db.query<SourceRun>(
    `SELECT * FROM (
       SELECT sr.*, ROW_NUMBER() OVER (PARTITION BY source ORDER BY started_at DESC) AS rn
       FROM source_runs sr
     ) t WHERE rn <= $1
     ORDER BY source ASC, started_at DESC`,
    [perSource]
  )
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
