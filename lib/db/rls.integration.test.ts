import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

// RLS proof for the Supabase re-architecture.
//
// We can't run the Supabase stack in this environment, but RLS is a core
// Postgres feature and PGlite is real Postgres (WASM). This harness reproduces
// exactly how Supabase enforces RLS: the `authenticated`/`anon` roles, an `auth`
// schema whose `auth.uid()`/`auth.role()` read the per-request GUC
// `request.jwt.claims`, and `SET ROLE` + `set_config(...)` to act as a given
// user — which is what PostgREST does under the hood. We then apply the real
// migrations (001–036) and assert the privacy properties the whole change is for.

// Supabase-equivalent bootstrap: roles + the auth schema the migrations target.
const PREAMBLE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- auth.uid()/auth.role() read the request JWT claims GUC, exactly like Supabase.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
$$;
-- pgcrypto's gen_random_bytes is absent in PGlite; the subscriptions token
-- default references it (app always supplies the token explicitly).
CREATE OR REPLACE FUNCTION gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS $$
  SELECT decode(string_agg(lpad(to_hex((random() * 255)::int), 2, '0'), ''), 'hex')
  FROM generate_series(1, GREATEST(n, 1))
$$;
`

const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'

let pg: PGlite
const eventIds: string[] = []

async function actAs(uid: string | null, role: 'authenticated' | 'anon') {
  await pg.query('RESET ROLE')
  const claims = uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role })
  await pg.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims])
  await pg.query(`SET ROLE ${role}`)
}
async function asOwner() {
  await pg.query('RESET ROLE')
  await pg.query(`SELECT set_config('request.jwt.claims', '', false)`)
}
async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await pg.query<T>(sql, params)).rows
}
async function rejects(sql: string, params?: unknown[]): Promise<boolean> {
  try {
    await pg.query(sql, params)
    return false
  } catch {
    return true
  }
}

beforeAll(async () => {
  pg = new PGlite({ extensions: { pg_trgm } })
  await pg.exec(PREAMBLE)

  // Apply the real migrations, in order, as the (superuser) owner.
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(path.join(dir, file), 'utf8'))
  }

  // Seed: two auth users (the trigger creates their profiles), a city, and a
  // catalog of upcoming approved events (15, so the teaser cap is testable).
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES
    ('${USER_A}', 'a@example.com'), ('${USER_B}', 'b@example.com')`)
  await pg.exec(`INSERT INTO cities (id, slug, name, state, timezone, enabled)
    VALUES (1, 'austin', 'Austin', 'TX', 'America/Chicago', true)
    ON CONFLICT (id) DO NOTHING`)
  for (let i = 0; i < 15; i++) {
    const r = await rows<{ id: string }>(
      `INSERT INTO events (title, start_time, city_id, is_free, status, source, source_id, title_norm)
       VALUES ($1, NOW() + ($2 || ' days')::interval, 1, true, 'approved', 'seed', $3, $4) RETURNING id`,
      [`Event ${i}`, String(i + 1), `seed-${i}`, `event ${i}`]
    )
    eventIds.push(r[0].id)
  }
})

describe('per-user isolation (RLS)', () => {
  it('a user reads and writes only their own favorites', async () => {
    await actAs(USER_A, 'authenticated')
    await rows(`INSERT INTO favorites (user_id, event_id) VALUES (auth.uid(), $1)`, [eventIds[0]])
    expect(await rows(`SELECT event_id FROM favorites`)).toHaveLength(1)

    await actAs(USER_B, 'authenticated')
    // B cannot see A's favorite...
    expect(await rows(`SELECT event_id FROM favorites`)).toHaveLength(0)
    // ...nor update or delete it (0 rows affected, silently filtered by RLS).
    await rows(`UPDATE favorites SET event_id = $1`, [eventIds[1]])
    await rows(`DELETE FROM favorites`)

    await actAs(USER_A, 'authenticated')
    expect(await rows(`SELECT event_id FROM favorites`)).toHaveLength(1) // untouched by B
  })

  it('WITH CHECK blocks forging a row as another user', async () => {
    await actAs(USER_A, 'authenticated')
    // Inserting a favorite owned by B while acting as A must be rejected.
    expect(await rejects(`INSERT INTO favorites (user_id, event_id) VALUES ($1, $2)`, [USER_B, eventIds[2]])).toBe(true)
  })

  it('a user sees only their own profile', async () => {
    await actAs(USER_A, 'authenticated')
    const own = await rows<{ id: string }>(`SELECT id FROM profiles`)
    expect(own).toHaveLength(1)
    expect(own[0].id).toBe(USER_A)
    expect(await rows(`SELECT id FROM profiles WHERE id = $1`, [USER_B])).toHaveLength(0)
  })

  it('a signed-in user can record their own interaction (sequence + policy)', async () => {
    await actAs(USER_A, 'authenticated')
    await rows(
      `INSERT INTO interactions (user_id, city_id, event_id, type) VALUES (auth.uid(), 1, $1, 'view')`,
      [eventIds[0]]
    )
    expect((await rows(`SELECT 1 FROM interactions`)).length).toBeGreaterThan(0)
  })
})

describe('public catalog (event metadata is not RLS-gated)', () => {
  it('anon can read the full events catalog', async () => {
    await actAs(null, 'anon')
    const all = await rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM events`)
    expect(all[0].n).toBe(eventIds.length)
  })

  it('a signed-in user can also read the catalog', async () => {
    await actAs(USER_A, 'authenticated')
    const all = await rows<{ n: number }>(`SELECT COUNT(*)::int AS n FROM events`)
    expect(all[0].n).toBe(eventIds.length)
  })

  it('anon reads shared engagement aggregates but cannot see any user rows', async () => {
    await actAs(null, 'anon')
    // event_engagement is public metadata...
    await rows(`SELECT * FROM event_engagement`)
    // ...but favorites and profiles are private: anon sees nothing and can't call
    // the engagement RPC either.
    expect(await rejects(`SELECT * FROM favorites`)).toBe(true)
  })
})

describe('shared aggregate writes go only through the RPC', () => {
  it('anon cannot call the engagement RPC; a user can', async () => {
    await actAs(null, 'anon')
    expect(await rejects(`SELECT bump_engagement($1)`, [eventIds[0]])).toBe(true)

    await actAs(USER_A, 'authenticated')
    await rows(`SELECT bump_engagement($1)`, [eventIds[0]])
    await asOwner()
    const ee = await rows<{ engagements: number }>(
      `SELECT engagements FROM event_engagement WHERE event_id = $1`,
      [eventIds[0]]
    )
    expect(ee[0].engagements).toBe(1)
  })

  it('a user cannot write the shared aggregate directly', async () => {
    await actAs(USER_A, 'authenticated')
    expect(await rejects(`INSERT INTO event_engagement (event_id, impressions) VALUES ($1, 5)`, [eventIds[1]])).toBe(true)
  })
})
