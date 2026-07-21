# Rewards & Badges catalog page — design

**Date:** 2026-07-21
**Status:** Approved (pending spec review)

## Goal

Give users a single page that details every badge and level, with quick-glance
hover tips explaining how to unlock each reward. Signed-in users also see which
badges they've already earned and their progress.

## Scope

- **In:** a public `/rewards` catalog page listing all badges and levels; custom
  hover tooltips with unlock conditions; earned-state overlay for signed-in
  users; a "View all badges" entry point from the account rewards panel.
- **Out:** any change to how badges are earned/awarded, the reward engine, the
  DB schema, or the celebration/toast flow. This page is read-only.

## Data source

All content is the static data already in `lib/rewards/catalog.ts`:
`BADGES` (id, name, description, art, tier, group, points) and `LEVELS`
(id, name, minPoints, tier). No new DB tables, migrations, or engine changes.

The `description` field is already the human-readable unlock condition
(e.g. "Attended fifteen events") — it becomes the hover tip verbatim.

## Architecture & data flow

New server component at `app/rewards/page.tsx`:

- Reads the session via `getUser()` from `@/lib/auth/server`.
- **Signed in:** calls `getRewardsSummary(supabase)` — the *read-only* helper in
  `lib/rewards/data.ts`. It only reads `user_badges`; it does **not** call
  `syncRewards`, so browsing the catalog never awards or mutates anything.
  Yields the earned badge id set, current level, points, and progress.
- **Signed out:** renders the full catalog with every badge shown as
  not-yet-earned (neutral "how to unlock" framing, no lock-shaming) and no
  level highlighted.
- `export const dynamic = 'force-dynamic'` (reads the session), but **indexable**
  (no `robots: noindex`) — the catalog content is public and identical either way.
- Best-effort like the rest of the rewards feature: if the session read or
  summary fails, fall back to the signed-out (all-locked) rendering rather than
  erroring.

## Page layout

1. **Sticky header** — matches `app/account/page.tsx`'s shell.
   - Logo: `/logo-icon.svg` (the site's standard mark, matching every other
     header) rendered with Next `<Image>`, same `<Link>` + wordmark pattern as
     `app/[city]/page.tsx:212-217`.
   - "← Back to events" link to `/austin` and a link to `/account`.
2. **Intro** — `h1` "Badges & Rewards" + one-line explainer.
3. **Levels section** — the 5 levels (`Newcomer → Local Legend`) as `MedalFrame`
   medallions (tier ring + point threshold as center text) with the level name
   and "N points" beneath. If signed in, the user's current level is marked
   ("You're here") and shows points-to-next.
4. **Badges by group** — the existing 6 groups in order (Getting started,
   Attendance, First-timer badges, Curation, Sharing, Loyalty). Each group has a
   heading and a responsive grid of badge medals. Earned badges render in full
   color; the rest muted — same visual language as `RewardsPanel`.

## The hover tips (core feature)

A new **custom Tailwind tooltip**, pure CSS — no JS, no new dependency:

- `components/rewards/Tooltip.tsx` — a small reusable primitive: a `group
  relative` wrapper with an absolutely-positioned tip that is `opacity-0
  group-hover:opacity-100` and also reveals on `focus-within` (keyboard/touch
  accessibility). Positioned **above** the trigger, themed with app tokens
  (`bg-popover`, `text-popover-foreground`, border, shadow, rounded), high
  `z-index`, with a pointer-events-none arrow.
- `components/rewards/BadgeCard.tsx` — composes a `MedalFrame` (rendered
  **without** its `title` prop, to avoid a double native tooltip) inside the
  `Tooltip`. The tip card shows:
  - Badge name + tier label (e.g. "Gold")
  - **How to unlock:** the `description`
  - Points value, and an "Earned ✓" marker when the user has it.

The levels in the Levels section reuse the same `Tooltip` with a "Reach N points"
tip for consistency.

## Refactor (targeted, in-scope)

`GROUP_LABELS` and `GROUP_ORDER` currently live inside
`components/RewardsPanel.tsx`. Move them into `lib/rewards/catalog.ts` and export
them so both the panel and the new page share one source of truth. Update
`RewardsPanel.tsx` to import them (no behavior change) and add a "View all badges
→" link pointing to `/rewards`.

## Files

| File | Change |
|---|---|
| `app/rewards/page.tsx` | new — the catalog page (server component) |
| `components/rewards/Tooltip.tsx` | new — CSS hover-tip primitive |
| `components/rewards/BadgeCard.tsx` | new — medal + rich unlock tooltip |
| `lib/rewards/catalog.ts` | export shared `GROUP_LABELS` / `GROUP_ORDER` |
| `components/RewardsPanel.tsx` | import shared constants; add `/rewards` link |

## Testing

- `BadgeCard` / `Tooltip` render test: asserts the unlock `description`, points,
  and tier render, and that earned vs. locked state is reflected.
- Coverage test: every badge in `BADGES` falls into one of `GROUP_ORDER`'s groups
  (guards against a new badge silently missing from the page), and every group
  with badges is represented.
- Follow existing test conventions (`lib/rewards/*.test.ts`, vitest).

## Non-goals / risks

- No awarding side effects on this page (explicitly `getRewardsSummary`, not
  `syncRewards`).
- Tooltip is CSS-only; if a medal sits at the grid's top edge the tip renders
  above and may need small top padding on the section — handled with layout, not
  JS repositioning.
- `user_badges` may be absent on the bare dev path; `getRewardsSummary` already
  degrades to an empty summary, so the page renders all-locked gracefully.
