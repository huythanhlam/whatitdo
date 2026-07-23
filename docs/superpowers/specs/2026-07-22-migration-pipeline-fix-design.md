# Migration pipeline fix — split legacy migrations out of the Supabase CLI range

**Date:** 2026-07-22
**Branch:** `claude/migration-pipeline-fix` (off `main`)
**Status:** Approved design, pending implementation plan

## Problem

`supabase db push` fails on every run (exit code 1), so pending migrations never
reach the production database. As of this writing, migrations `038_austin_monthly`,
`038_two_month_lookahead`, `039_rewards` (the `user_badges` table), `040_admin_role`,
and `041_disable_luma_ics_austin` are all **unapplied on prod** despite being merged
to `main`.

### Root cause: two migration systems + duplicate version prefixes

The repo runs two migration mechanisms by design (`lib/db/migrate.ts`):

- **≤ 033** — the legacy runner (`npm run migrate` + PGlite dev/test), ledger
  `_migrations` keyed by **filename**, tolerant of duplicate numeric prefixes.
- **≥ 034** — the Supabase CLI (`supabase db push`), ledger
  `supabase_migrations.schema_migrations` keyed by **numeric version**, which
  cannot represent duplicate prefixes.

`supabase/migrations/` contains duplicate prefixes: `024` (×2), `025` (×3),
`038` (×2). The Supabase CLI scans the whole directory and hits two blockers:

1. **Legacy phantoms (`024`×2, `025`×3):** remote `schema_migrations` records one
   `024` and one `025`; the extra files have no representable version. The CLI
   flags them as "must be inserted before the last remote migration" and refuses
   without `--include-all`. `migration repair` cannot target a duplicate version.
   `--include-all` would **re-run** `024_luma.sql`'s `INSERT INTO sources`, which
   fails because `sources.name` is `UNIQUE` (`008_sources.sql`). Dead end.
2. **`038` collision (unapplied):** two files share version `038`; even a single
   clean push cannot insert version `038` twice.

## Approach (chosen: A — directory split)

Make the Supabase CLI only ever see the unique `≥ 034` range. Move everything
`≤ 033` into a directory that only the legacy runner, PGlite, and the integration
tests read. Then a plain `supabase db push` applies the pending migrations in
order — no `--include-all`, no re-running SQL, no phantom problem.

Rejected alternatives:
- **C (unify onto `npm run migrate`):** drop the PGlite-only ceiling for real
  Postgres and retire `db push`. Cleaner long-term but depends on the prod
  `_migrations` ledger state (unknown) and a one-time reconcile to avoid re-running
  `001`–`037`. Higher risk; deferred.
- **`--include-all` / `migration repair`:** structurally impossible with duplicate
  prefixes (see root cause).

## Changes

All on `claude/migration-pipeline-fix`, off `main`. Kept separate from feature PRs.

### 1. Move `001`–`033` → `supabase/migrations-legacy/`
36 files (33 unique versions + the 3 duplicate `024`/`025` extras). The legacy
`_migrations` ledger is filename-keyed, so duplicates remain fine here. After the
move, `supabase/migrations/` holds only `034`–`041` (the CLI-managed range).

Use `git mv` so history is preserved.

### 2. Renumber the `038` collision
Keep `038_austin_monthly.sql`. Rename `038_two_month_lookahead.sql` →
`042_two_month_lookahead.sql`. It is an order-independent `UPDATE` to
`crawl:365thingsaustin-com` (not referenced by number in code). `042` avoids the
already-merged `040_admin_role` and `041_disable_luma_ics_austin`. Use `git mv`.

Result — CLI range now unique: `034, 035, 036, 037, 038, 039, 040, 041, 042`.

### 3. Point the legacy runner at the new dir — `lib/db/migrate.ts`
`migrationsDir()` (line 16) → `supabase/migrations-legacy/`. The directory is now
the boundary; the `LEGACY_MIGRATION_CEILING = 33` filter (line 36) becomes a
redundant safety net. Keep the filter but update the module comment to describe the
directory split as the primary mechanism.

### 4. Trace both dirs into the serverless bundle — `next.config.ts`
Line 12 currently traces `supabase/migrations/**/*`. Add
`supabase/migrations-legacy/**/*` so the PGlite production fallback still finds the
legacy files.

### 5. Update the RLS integration test — `lib/db/rls.integration.test.ts`
Line 73 reads `supabase/migrations/` directly and applies every `.sql` sorted to a
faux-auth PGlite (reconstructing the full `001`→`039` schema). Change it to read
**both** dirs, concatenate, and sort by version so the full schema still builds.

`lib/db/db.integration.test.ts` applies migrations via `migrate()` (not by reading
the dir), so it is covered automatically by change #3 — no edit needed.

## Prod reconcile (run by the user against the linked project)

The agent cannot reach prod. After the code changes land:

1. **Reconcile the remote ledger (REQUIRED).** Verified on 2026-07-22: `supabase
   db push` does **not** tolerate remote-only history — with `001`–`033` moved out
   of `supabase/migrations/`, it errors `Remote migration versions not found in
   local migrations directory`. The remote CLI ledger must be told to forget
   `001`–`033` (now owned by the legacy `_migrations` ledger):
   ```
   supabase migration repair --status reverted 001 002 003 004 005 006 007 008 \
     009 010 011 012 013 014 015 016 017 018 019 020 021 022 023 024 025 026 027 \
     028 029 030 031 032 033
   ```
   `--status reverted` edits ONLY `supabase_migrations.schema_migrations`; it runs
   no down-migration and drops no schema. Remote ledger becomes `034`–`037`.
2. **Apply:** `supabase db push` — applies `038, 039, 040, 041, 042` (everything
   after remote's max `037`) in order and records them. Lands the rewards table,
   the two Austin crawler sources, admin role, and the luma-ics disable. In CI this
   is the `migrate` job's push step; re-run it after the repair.

## Sequencing

- This branch merges to `main` → the `db push` pipeline works going forward.
- **Optional immediate win:** apply the luma-ics one-liner (and, if desired, the
  other pending migrations) manually in the SQL editor now so they are live before
  this merges. All are idempotent-safe to re-apply, or will simply be recorded by
  the reconcile push.

## Verification (before calling done)

- `npm test` — the integration tests exercise the directory split (esp.
  `rls.integration.test.ts` rebuilding the schema from both dirs).
- `npx tsc --noEmit` — type check.
- `npm run migrate` against a throwaway Postgres — confirm the legacy runner still
  applies `001`→`033` from `supabase/migrations-legacy/`.
- `npm run lint`.

## Out of scope

- Retiring the dual-system / PGlite (Approach C) — deferred.
- Any change to what the individual migrations do.
- Cross-worktree migration-number coordination policy (flagged separately; the
  user serializes merges).
