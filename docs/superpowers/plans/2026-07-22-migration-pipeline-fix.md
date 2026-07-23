# Migration Pipeline Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock `supabase db push` by moving the legacy `≤033` migrations out of the Supabase-CLI-managed directory and giving the duplicate `038` a unique version, so pending migrations reach production.

**Architecture:** The repo runs two migration systems: a legacy filename-keyed runner (`npm run migrate` + PGlite, `≤033`) and the Supabase CLI (`db push`, `≥034`). The CLI cannot represent the duplicate version prefixes (`024`, `025`, `038`) it finds in `supabase/migrations/`. This plan physically separates the `≤033` files into `supabase/migrations-legacy/` (read only by the legacy runner + integration tests) and renumbers the duplicate `038` file, leaving `supabase/migrations/` with a clean, unique `≥034` sequence.

**Tech Stack:** TypeScript, Next.js 16, Vitest, PGlite (dev/test), Supabase CLI + Postgres (prod), `git mv`.

## Global Constraints

- Preserve git history on all file moves — use `git mv`, never delete + recreate.
- Never edit what a migration *does*; only move or renumber files and update the code that reads them.
- The `038_two_month_lookahead.sql` renumber target is exactly `042` (avoids the already-merged `040_admin_role` and `041_disable_luma_ics_austin`).
- Legacy directory name is exactly `supabase/migrations-legacy/`.
- Every task ends with the full test suite green (`npm test`).

---

### Task 1: Renumber the duplicate `038` migration

Gives the second `038` file a unique version so the `≥034` range has no collisions. It is an order-independent `UPDATE` to `crawl:365thingsaustin-com`, safe to move later in the sequence.

**Files:**
- Rename: `supabase/migrations/038_two_month_lookahead.sql` → `supabase/migrations/042_two_month_lookahead.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a `supabase/migrations/` directory whose `≥034` files all have unique numeric prefixes: `034, 035, 036, 037, 038, 039, 040, 041, 042`.

- [ ] **Step 1: Confirm nothing references the file by name**

Run:
```bash
grep -rniE "038_two_month_lookahead" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" . | grep -v node_modules
```
Expected: no matches (the file is referenced only by directory scan, never by hardcoded name).

- [ ] **Step 2: Rename with git**

Run:
```bash
git mv supabase/migrations/038_two_month_lookahead.sql supabase/migrations/042_two_month_lookahead.sql
```

- [ ] **Step 3: Verify the `≥034` range is now unique**

Run:
```bash
ls supabase/migrations/ | awk -F_ '$1 >= 34' | sort
```
Expected exactly:
```
034_supabase_auth_profiles.sql
035_rls_policies.sql
036_rpcs.sql
037_password_auth.sql
038_austin_monthly.sql
039_rewards.sql
040_admin_role.sql
041_disable_luma_ics_austin.sql
042_two_month_lookahead.sql
```

- [ ] **Step 4: Run the integration test that applies every migration**

Run:
```bash
npx vitest run lib/db/rls.integration.test.ts
```
Expected: PASS. (The test applies all migrations sorted; `042` now runs after `041` instead of at `038` — order-independent, so RLS assertions still hold.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Renumber duplicate 038 migration to 042

038_two_month_lookahead.sql shared version 038 with 038_austin_monthly.sql,
which the Supabase CLI's version-keyed ledger cannot represent. It is an
order-independent UPDATE, so renumbering to 042 (after the merged 040/041)
resolves the collision with no behavior change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Split `≤033` migrations into `supabase/migrations-legacy/`

Moves the 36 legacy files (33 unique versions + the 3 duplicate `024`/`025` extras) out of the CLI's view and repoints every reader. This is one atomic refactor: the move, the runner repoint, and the test-reader update must land together or the suite is red in between.

**Files:**
- Move: `supabase/migrations/001_*.sql` … `033_*.sql` (36 files) → `supabase/migrations-legacy/`
- Modify: `lib/db/migrate.ts:15-17` (`migrationsDir()`) and its module comment
- Modify: `lib/db/rls.integration.test.ts:72-76` (migration-applying loop)
- Modify: `next.config.ts:11-13` (`outputFileTracingIncludes`)
- Modify: `lib/recs/config.ts:117` (stale path comment — `031_ml.sql` moves)

**Interfaces:**
- Consumes: the unique `≥034` sequence from Task 1.
- Produces: `supabase/migrations/` containing only `034`–`042`; `supabase/migrations-legacy/` containing `001`–`033`; the legacy runner and RLS test reading the correct dir(s).

- [ ] **Step 1: Create the legacy directory and move the `≤033` files**

Run:
```bash
mkdir -p supabase/migrations-legacy
for f in $(ls supabase/migrations | awk -F_ '$1 <= 33'); do git mv "supabase/migrations/$f" "supabase/migrations-legacy/$f"; done
```

- [ ] **Step 2: Verify the split**

Run:
```bash
echo "legacy count:"; ls supabase/migrations-legacy | wc -l
echo "cli range:"; ls supabase/migrations
```
Expected: `legacy count: 36`, and `cli range:` lists exactly `034`–`042` (9 files).

- [ ] **Step 3: Repoint the legacy runner — `lib/db/migrate.ts`**

Replace the `migrationsDir()` function (lines 15-17) and update the module comment. New `migrationsDir()`:
```typescript
// Legacy (≤033) migrations live here, physically separated from the
// Supabase-CLI-managed ≥034 range so the CLI never sees duplicate version
// prefixes (024/025). This runner + PGlite own only the legacy directory.
function migrationsDir(): string {
  return path.join(process.cwd(), 'supabase', 'migrations-legacy')
}
```
Leave the `LEGACY_MIGRATION_CEILING = 33` filter (line 36) in place — it is now a redundant safety net, since the directory is the boundary.

- [ ] **Step 4: Update the RLS integration test to read both dirs — `lib/db/rls.integration.test.ts`**

Replace the loop at lines 72-76 with:
```typescript
  // Apply the real migrations, in order, as the (superuser) owner. Legacy
  // (≤033) migrations live in supabase/migrations-legacy/; the Supabase-era
  // (≥034) migrations in supabase/migrations/. Apply the union in version order
  // (zero-padded numeric prefixes sort correctly across both dirs).
  const migrationDirs = [
    path.join(process.cwd(), 'supabase', 'migrations-legacy'),
    path.join(process.cwd(), 'supabase', 'migrations'),
  ]
  const migrationFiles = migrationDirs
    .flatMap(dir => readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => ({ dir, f })))
    .sort((a, b) => a.f.localeCompare(b.f))
  for (const { dir, f } of migrationFiles) {
    await pg.exec(readFileSync(path.join(dir, f), 'utf8'))
  }
```

- [ ] **Step 5: Trace both dirs into the bundle — `next.config.ts`**

Replace line 12 (`'/*': ['supabase/migrations/**/*'],`) with:
```typescript
    '/*': ['supabase/migrations/**/*', 'supabase/migrations-legacy/**/*'],
```

- [ ] **Step 6: Fix the stale path comment — `lib/recs/config.ts:117`**

Change `supabase/migrations/031_ml.sql` to `supabase/migrations-legacy/031_ml.sql` in the comment (the file moved in Step 1).

- [ ] **Step 7: Run the full test suite**

Run:
```bash
npm test
```
Expected: PASS. Key coverage: `rls.integration.test.ts` rebuilds the full `001`→`042` schema from both dirs; `db.integration.test.ts` applies migrations via `migrate()`, which now reads the legacy dir.

- [ ] **Step 8: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9: Verify the legacy runner applies from the new dir against real Postgres**

Start a throwaway Postgres and run the runner against it:
```bash
docker run -d --rm --name migtest -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16
sleep 4
DATABASE_URL="postgres://postgres:pw@localhost:55432/postgres" npm run migrate
docker stop migtest
```
Expected: `Applying 36 migration file(s) ...` then `Migrations up to date.` with no error. (All 36 legacy files are `≤33`, so the ceiling filter keeps every one; each applies once by filename on the fresh DB.)

> If Docker is unavailable, skip this step and rely on the PGlite integration tests from Step 7, which exercise the same `migrate()` path — note the skip when reporting.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Split legacy ≤033 migrations into supabase/migrations-legacy/

The Supabase CLI (db push) scans supabase/migrations/ and cannot represent
the duplicate version prefixes among the legacy 024/025 files, so every push
failed and 038/039/040/041 never reached prod. Move the 36 ≤033 files into a
directory owned only by the legacy runner + PGlite + integration tests,
leaving the CLI a clean unique ≥034 sequence. Repoint migrate.ts, the RLS
integration test (reads both dirs), the bundle trace, and a stale comment.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Lint, push, and open the PR

Final quality gate and hand-off. No code changes unless lint flags something.

**Files:** none (unless lint auto-fixes).

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: a pushed branch + PR ready for review; the prod reconcile documented for the user to run.

- [ ] **Step 1: Lint**

Run:
```bash
npm run lint
```
Expected: no errors. If auto-fixable issues appear, run `npx eslint --fix`, re-run, and `git commit -am "Lint fixes"`.

- [ ] **Step 2: Push the branch**

Run:
```bash
git push -u origin claude/migration-pipeline-fix
```

- [ ] **Step 3: Open the PR**

Run:
```bash
gh pr create --base main --head claude/migration-pipeline-fix \
  --title "Fix migration pipeline: split legacy ≤033 out of the Supabase CLI range" \
  --body "$(cat <<'BODY'
## What
Separates the legacy `≤033` migrations into `supabase/migrations-legacy/` and renumbers the duplicate `038_two_month_lookahead.sql` → `042`, so `supabase db push` sees a clean, unique `≥034` sequence.

## Why
`supabase db push` has been failing on every run because `supabase/migrations/` contains duplicate version prefixes (`024`×2, `025`×3, `038`×2) that the CLI's version-keyed ledger cannot represent. As a result, migrations `038`, `039` (`user_badges`), `040_admin_role`, and `041_disable_luma_ics_austin` were merged to `main` but never applied to production.

Design spec: `docs/superpowers/specs/2026-07-22-migration-pipeline-fix-design.md`

## Changes
- Move 36 `≤033` files → `supabase/migrations-legacy/` (`git mv`, history preserved).
- Renumber `038_two_month_lookahead.sql` → `042` (order-independent `UPDATE`).
- Repoint the legacy runner (`lib/db/migrate.ts`) and bundle trace (`next.config.ts`) at the new dir; add it alongside for the RLS integration test.
- No migration behavior changes.

## Reviewer notes
- Two migration systems by design: legacy runner + PGlite own `≤033`; Supabase CLI owns `≥034`. This just fences them by directory.
- **Post-merge, the maintainer runs the prod reconcile** (the agent cannot reach prod):
  1. `supabase migration list` (read-only) — confirm `001`–`033` show as harmless "remote-only" and the CLI does not error on divergence.
  2. `supabase db push` — applies `038, 039, 040, 041, 042` (all after remote's max `037`) and records them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```
Expected: prints the PR URL.

- [ ] **Step 4: Report the PR URL and the prod-reconcile steps to the user.**

---

## Post-merge: the CI job applies it automatically

The apply step is **not manual** — `.github/workflows/ci.yml`'s `migrate` job runs on every push to `main` and already executes `supabase db push` in its "Push Supabase-era migrations (034+)" step (secrets `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_ID` / `SUPABASE_DB_PASSWORD` are set). That step is exactly what has been failing, with:

```
Found local migration files to be inserted before the last migration on remote database.
  supabase/migrations/024_luma.sql
  supabase/migrations/025_fix_partiful_image_urls.sql
  supabase/migrations/025_meanwhile_dedicated_parser.sql
```

This PR moves those phantom files out of `supabase/migrations/`, so `supabase db push` no longer hits the duplicate-prefix error. Applied migrations `038, 039, 040, 041, 042` are all after remote's max `037`, so once the ledger is reconciled (below) they apply with no `--include-all` and no re-running SQL.

Compatibility with the CI job is preserved: its earlier "Apply legacy migrations (≤ 033)" step runs `npm run migrate`, which this PR repointed to `supabase/migrations-legacy/` — so it still applies the `≤033` set (already recorded in the `_migrations` ledger → no-ops).

### REQUIRED one-time ledger reconcile

Moving `001`–`033` out of `supabase/migrations/` leaves the remote `supabase_migrations.schema_migrations` ledger holding versions the local dir no longer has, so `supabase db push` fails with:

```
Remote migration versions not found in local migrations directory.
```

Verified on 2026-07-22: `db push` does **not** tolerate this divergence. The remote CLI ledger must be told to forget `001`–`033` (they are now owned by the legacy `_migrations` ledger). `supabase migration repair --status reverted` edits ONLY the bookkeeping table — it runs no down-migration and drops no schema; the `001`–`033` objects are untouched.

**Maintainer steps (one-time):**
1. **Merge this PR** so `main`'s `supabase/migrations/` is the clean `034`–`042` set. (The CI push it triggers fails once more with the divergence error above — harmless, applies nothing.)
2. **Reconcile the remote ledger**, from a prod-linked checkout:
   ```bash
   supabase migration repair --status reverted 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022 023 024 025 026 027 028 029 030 031 032 033
   ```
   Remote ledger becomes `034`–`037`, matching local `034`–`037`.
3. **Re-run the failed `migrate` job** (Actions → the run → "Re-run failed jobs"). `db push` now applies `038, 039, 040, 041, 042` — the `user_badges` rewards table, the two Austin crawler sources, admin role, and the luma-ics disable.

This is genuinely one-time; after the revert, future pushes deal only with the unique `034+` range and need no intervention.

### Rollout note (2026-07-23): `040_admin_role` schema drift

After the ledger reconcile, the push applied `038` and `039` but aborted on `040_admin_role.sql`:

```
ERROR: column "is_admin" of relation "profiles" already exists (SQLSTATE 42701)
At statement: 0 — ALTER TABLE profiles ADD COLUMN is_admin ...
```

The `is_admin` column was already present on the production project (added out of band and never recorded in `schema_migrations`). A follow-up PR guards the add with `ADD COLUMN IF NOT EXISTS`; the rest of `040` (REVOKE/GRANT, seed `UPDATE`, `CREATE OR REPLACE FUNCTION`) is already idempotent, so the migration is now safely re-runnable and converges regardless of pre-existing state. `038`/`039` were applied and recorded by the aborted push, so the retry only applies `040, 041, 042`.

Optional immediate win (before the merge): apply the luma-ics one-liner in the SQL editor now — `UPDATE sources SET enabled = false WHERE name = 'crawl:luma-ics-austin';` — since it is idempotent and the CI push will simply record it.
