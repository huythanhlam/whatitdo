# Agent loops for this repo

Recipes for running Claude Code in loops on what-it-do, per the Claude Code
team's guidance on loop design: pick the loop type by how it's triggered and
how it stops, give it deterministic stop criteria, and encode verification as
skills so the agent can check its own work.

The repo-side plumbing loops rely on:

- **Skills**: `.claude/skills/verify-app` (how to verify any change
  end-to-end) and `.claude/skills/add-event-source` (the source adapter
  playbook).
- **Deterministic checks**: `npm run lint`, `npm run typecheck`, `npm test`,
  `npx next build` — the same four gates as `.github/workflows/ci.yml`.
- **Observability**: `GET /api/admin/health` reports per-source run history
  and a computed `stale` list from the `source_runs` ledger.
- **Zero-credential mode**: with no env vars the app runs on embedded PGlite
  with seeded events, so loops can verify end-to-end without touching prod.

## Turn-based (default)

Just prompt. The verification skills do the heavy lifting: an agent that
changes a component or a source is expected to run `verify-app` before
reporting done, so fewer turns are spent on you manually checking.

## Goal-based (`/goal`)

Use when done is checkable. Good stop conditions here:

```
/goal after the change, npm run lint, npm run typecheck, npm test and
      npx next build all pass. Stop after 5 tries.
```

```
/goal homepage Lighthouse performance score ≥ 90 against a production build
      (npm run build && npm start). Stop after 5 tries.
```

```
/goal the new source's parsers.test.ts block passes and a local ingest run
      shows events_upserted > 0 in /api/admin/health. Stop after 5 tries.
```

## Time-based (`/loop`, `/schedule`)

For work driven by external systems:

```
/loop 10m check my open PR, address review comments, and fix failing CI
```

(CI takes a few minutes per run — a tighter interval than ~10m just burns
tokens re-checking an unchanged state.)

```
/schedule daily: fetch /api/admin/health on the production site.
```

## Proactive (composed)

Sources break when upstream sites change — recurring, well-defined,
verifiable work, which is exactly what proactive loops are for:

```
/schedule daily: check /api/admin/health for stale sources.
/goal for each stale source, follow the add-event-source skill's
      "fixing a stale source" playbook until its run is ok with
      events_upserted > 0, then open a PR. Stop after 5 tries per source.
```

Token-usage guardrails when running this:

- Pilot on a single stale source before letting it run the full list.
- Daily is enough — the ingest cron itself only runs once a day
  (`vercel.json`), so health data doesn't change faster than that.
- Have a second agent review the fix (`/code-review`) — fresh context, not
  biased by the fixing agent's reasoning.
- Review spend with `/usage`; `/goal` with no arguments shows turns and
  tokens used so far.
