<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Verification & repo conventions

- Verify every non-trivial change with the `verify-app` skill
  (`.claude/skills/verify-app/SKILL.md`). The CI gate is exactly:
  `npm run lint`, `npm run typecheck`, `npm test`, `npx next build`
  (`.github/workflows/ci.yml`).
- With no env vars the app runs fully locally on embedded PGlite with seeded
  events — end-to-end verification never needs credentials or a real database.
- Work on `lib/sources/` follows the `add-event-source` skill
  (`.claude/skills/add-event-source/SKILL.md`): adapter contract, one-line
  registry entry, real captured fixture, no-fabricated-dates parser test.
- `/api/ingest`, `/api/import`, `/api/email/digest`, `/api/featured` expose
  GET handlers that mutate — deliberate (Vercel Cron + manual testing), guarded
  by `lib/auth.ts`. Don't "fix" this.
- Files in `docs/` (CODEBASE-REVIEW, SIMPLIFICATION-SPEC, PRODUCT-SPEC, plans)
  are point-in-time snapshots, not ground truth — some reference pre-refactor
  paths like `lib/scrapers/` (now `lib/sources/`) and files that no longer
  exist. Trust the code and this file over them.
