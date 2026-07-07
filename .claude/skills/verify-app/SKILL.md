---
name: verify-app
description: Verify any change to what-it-do end-to-end before declaring it done — run the CI gate, then boot the app in zero-credential mode and exercise the affected flow. Use after every non-trivial code change, and as the exit criteria for /goal loops.
---

# Verifying changes to what-it-do

Never report a change as complete based on a successful edit alone. Verify it
the way CI and a human reviewer would. If any step fails, fix the issue and
rerun from step 1 — do not hand back partially verified work.

## 1. Fast gate (mirrors `.github/workflows/ci.yml` exactly)

Run all four, in order — a PR is not mergeable unless all pass:

```bash
npm run lint
npm run typecheck    # = tsc --noEmit
npm test             # vitest: pure fns + fixture parsers + PGlite integration
npx next build
```

## 2. End-to-end gate (zero-credential mode)

The app runs with **no env vars at all**: unset `DATABASE_URL` and it uses
embedded in-memory PGlite, auto-migrated from `supabase/migrations/` and
populated by the `seed` source — so full end-to-end verification is free and
touches nothing real.

```bash
npm run dev   # no .env.local needed
```

Then, for whichever surface the change touched:

- **Pages**: load `/` (grid + calendar via `?view=`), a detail page
  `/events/[id]`, and `/subscribe`. Filters are URL query-param state
  (`?q=`, `?categories=`, `?date=`, `?free=`) — exercise the ones affected.
- **UI changes**: interact with the change directly using Playwright with the
  preinstalled Chromium (`executablePath: '/opt/pw-browsers/chromium'` if the
  default lookup fails). Click the control, confirm the expected state change,
  and screenshot before/after. Zero new browser-console errors or warnings.
- **Ingest/source changes**: `curl -X POST http://localhost:3000/api/ingest`
  (cron auth is open in development — `lib/auth.ts`), then check
  `curl http://localhost:3000/api/admin/health` — expect `healthy: true` and a
  fresh `source_runs` row for the touched source with `events_upserted > 0`
  (or `skipped` if its key is intentionally absent).
- **Email/subscribe changes**: POST to `/api/subscribe` and confirm the
  double-opt-in row via the integration-test patterns in
  `lib/db/db.integration.test.ts`.
- Watch the dev-server terminal: zero new errors or unexplained warnings.

## 3. Quantitative checks (when relevant)

The more quantitative the check, the better it works as a `/goal` stop
condition:

- Test count: `npm test` reports pass/fail counts — all green, none skipped.
- Performance: homepage is RSC + ISR (`revalidate = 900`); for perf-sensitive
  changes run a Lighthouse audit against `npm run build && npm start`.

## Repo-specific gotchas

- This repo runs a modified Next.js 16 — read `node_modules/next/dist/docs/`
  before writing framework code (see `AGENTS.md`).
- New-event validation is fail-closed: `lib/persist.ts` rejects undateable
  events and events >18 months out. "0 events upserted" after a change is a
  finding, not a pass.
- Gemini-dependent sources (`newspapers`, `social`, `crawl`, `youtube`) are
  `skipped` without `GEMINI_API_KEY` — that's expected locally, not a failure.
