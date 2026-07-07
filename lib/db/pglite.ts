import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { fetchSeedEvents } from '@/lib/sources/seed'
import { tagByKeyword } from '@/lib/tagger'
import { imageForCategories } from '@/lib/images'
import { normalizeTitle, normalizeVenue } from '@/lib/normalize'
import type { Db } from './driver'
import { migrate } from './migrate'

// Embedded in-memory Postgres for zero-credential local development, and the
// default store in production when no DATABASE_URL is configured. Because PGlite
// is in-memory and per-instance on serverless (its on-disk driver throws on this
// runtime), each fresh instance MUST be self-sufficient: init() applies the
// shared migrations AND seeds a baseline set of real Austin events so every page
// load has data immediately, without depending on the daily /api/ingest cron
// (which would only populate one ephemeral instance's memory).
//
// Stored on globalThis: Next.js bundles route handlers and RSC pages into
// separate module registries, so a plain module-level singleton would create a
// *separate* PGlite instance per bundle — and instances don't share data.
const globalForPglite = globalThis as unknown as { __pgliteDb?: Promise<Db> }

// Supabase provides these objects natively; PGlite does not. Synthesizing them
// here lets the *unmodified* Supabase migrations (which reference the `auth`
// schema, the API roles, and pgcrypto's gen_random_bytes) run verbatim on
// PGlite, so there is exactly one schema for both drivers. Applied to PGlite
// only — never to real Postgres.
const PREAMBLE = `
DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $fn$ SELECT 'service_role'::text $fn$;
CREATE OR REPLACE FUNCTION auth.uid()  RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
-- pgcrypto is unavailable in PGlite; the subscriptions token default references
-- gen_random_bytes. The app always supplies the token explicitly, so this shim
-- only needs to let CREATE TABLE resolve the default expression.
CREATE OR REPLACE FUNCTION gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS $fn$
  SELECT decode(string_agg(lpad(to_hex((random() * 255)::int), 2, '0'), ''), 'hex')
  FROM generate_series(1, GREATEST(n, 1))
$fn$;
`

function wrap(pg: PGlite): Db {
  return {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      (await pg.query<T>(sql, params as unknown[])).rows,
    exec: async (sql: string) => {
      await pg.exec(sql)
    },
  }
}

async function init(): Promise<Db> {
  const pg = new PGlite({ extensions: { pg_trgm } })
  await pg.exec(PREAMBLE)
  const db = wrap(pg)
  await migrate(db)
  await seedBaselineEvents(db)
  return db
}

// Insert baseline events so a fresh in-memory instance is never empty. Uses the
// deterministic seed source with keyword-based category tagging (no API calls)
// and category-themed fallback images. Idempotent via an event_sources lookup so
// a re-run of init() or a later ingest won't duplicate rows.
async function seedBaselineEvents(db: Db): Promise<void> {
  const slugToId = new Map<string, number>()
  const cats = await db.query<{ id: number; slug: string }>(`SELECT id, slug FROM categories`)
  for (const c of cats) slugToId.set(c.slug, c.id)

  const events = await fetchSeedEvents()

  for (const raw of events) {
    // Idempotent: skip if this (source, external_id) is already recorded.
    const seen = await db.query<{ event_id: string }>(
      `SELECT event_id FROM event_sources WHERE source = $1 AND external_id = $2`,
      [raw.source, raw.source_id]
    )
    if (seen.length > 0) continue

    const slugs = tagByKeyword(raw.title, raw.description)
    const imageUrl = raw.image_url ?? imageForCategories(slugs)
    const venueNorm = normalizeVenue(raw.venue_name)
    const titleNorm = normalizeTitle(raw.title, raw.venue_name)

    const res = await db.query<{ id: string }>(
      `INSERT INTO events (title, description, start_time, end_time, venue_name,
        venue_address, image_url, ticket_url, source, source_id, is_free,
        price_min, price_max, city_id, title_norm, venue_norm, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, 1, $14, $15, NOW())
       RETURNING id`,
      [raw.title, raw.description, raw.start_time, raw.end_time, raw.venue_name,
       raw.venue_address, imageUrl, raw.ticket_url, raw.source, raw.source_id,
       raw.is_free, raw.price_min, raw.price_max, titleNorm, venueNorm]
    )
    const eventId = res[0]?.id
    if (!eventId) continue

    await db.query(
      `INSERT INTO event_sources (event_id, source, external_id, url)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [eventId, raw.source, raw.source_id, raw.ticket_url]
    )

    for (const slug of slugs) {
      const cid = slugToId.get(slug)
      if (!cid) continue
      await db.query(
        `INSERT INTO event_categories (event_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [eventId, cid]
      )
    }
  }
}

export function getPgliteDb(): Promise<Db> {
  if (!globalForPglite.__pgliteDb) globalForPglite.__pgliteDb = init()
  return globalForPglite.__pgliteDb
}
