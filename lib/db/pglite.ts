import { PGlite } from '@electric-sql/pglite'
import { CATEGORIES } from '@/lib/categories'

// Embedded in-memory Postgres for zero-credential local development. Activated
// automatically by lib/db when no Supabase project is configured. Data re-seeds
// on restart via POST /api/ingest (on-disk persistence is avoided because
// PGlite's Node filesystem driver throws on this runtime).
//
// Stored on globalThis: Next.js bundles route handlers and RSC pages into
// separate module registries, so a plain module-level singleton would create a
// *separate* PGlite instance per bundle — and instances don't share data.
// globalThis is shared across all bundles in the Node process, guaranteeing a
// single shared database for both writes (ingest) and reads (pages/APIs).
const globalForPglite = globalThis as unknown as { __pglite?: Promise<PGlite> }

async function init(): Promise<PGlite> {
  const db = new PGlite()

  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id   SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT,
      start_time    TIMESTAMPTZ NOT NULL,
      end_time      TIMESTAMPTZ,
      venue_name    TEXT,
      venue_address TEXT,
      image_url     TEXT,
      ticket_url    TEXT,
      source        TEXT NOT NULL,
      source_id     TEXT,
      is_free       BOOLEAN DEFAULT false,
      price_min     NUMERIC(10,2),
      price_max     NUMERIC(10,2),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(source, source_id)
    );

    CREATE TABLE IF NOT EXISTS event_categories (
      event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id             TEXT PRIMARY KEY,
      email          TEXT UNIQUE NOT NULL,
      user_id        TEXT,
      frequency      TEXT NOT NULL DEFAULT 'daily',
      category_slugs TEXT[] DEFAULT '{}',
      token          TEXT UNIQUE NOT NULL,
      confirmed      BOOLEAN DEFAULT false,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS featured_listings (
      id          TEXT PRIMARY KEY,
      event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,
      starts_at   TIMESTAMPTZ NOT NULL,
      ends_at     TIMESTAMPTZ NOT NULL,
      ad_label    TEXT DEFAULT 'Featured',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // Seed categories (idempotent)
  for (const c of CATEGORIES) {
    await db.query(
      `INSERT INTO categories (slug, name, color) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO NOTHING`,
      [c.slug, c.name, c.color]
    )
  }

  return db
}

export function getPglite(): Promise<PGlite> {
  if (!globalForPglite.__pglite) globalForPglite.__pglite = init()
  return globalForPglite.__pglite
}
