# AI Logo Generation Playbook — Whats Happenin

**Date:** 2026-07-20
**Status:** Design / playbook (repeatable process, not a one-off task)
**Goal:** Produce a distinctive, icon-only logo mark for Whats Happenin using a
general-purpose AI image generator (ChatGPT/DALL·E or Gemini), then finish it as
a production-ready SVG wired into the app.

---

## 0. Decisions locked in

| Decision | Choice |
| --- | --- |
| Deliverable of the playbook | A **production-ready SVG** in the repo (favicon, header, OG) |
| AI tool | **ChatGPT/DALL·E or Gemini** (general-purpose, raster, weak at text) |
| Logo form | **Icon / symbol only** — no baked-in lettering |
| Concept | **Pin-meets-burst** — a location marker fused with celebratory energy |
| Wordmark | Stays in code, set in **Unbounded** (unchanged by this work) |

**Why icon-only:** DALL·E/Gemini render text unreliably. Keeping the name out of
the generated art sidesteps their biggest weakness and gives us a mark that
doubles as a favicon and app tile. The "Whats Happenin" wordmark continues to be
real text in the Unbounded font.

---

## 1. Brand brief (feed this context to the AI)

Keep this in front of the model every round so it stays on-target.

- **What it is:** Whats Happenin is a multi-city local-events aggregator (Austin
  + Houston today). It answers "what's happening near me tonight/this weekend?" —
  concerts, festivals, comedy, food & drink, arts.
- **Personality:** Poster-bold, warm, playful, local. Not corporate, not techy.
- **Concept to explore:** a **map pin / location marker fused with a
  burst/spark/confetti** — "something is happening *here*." This unifies the two
  chosen ideas (celebration/energy + place/discovery).
- **Palette (exact hexes):**
  - Coral / primary — `#F17A7E`
  - Teal-slate / foreground — `#4A6163`
  - Sunny yellow / accent — `#FFC94B`
  - Warm cream / background — `#F9FAF4`
- **Hard constraints (every prompt):**
  - **No text, no letters, no words** in the image.
  - Flat vector illustration style, bold even strokes, high contrast.
  - Single centered mark on a plain solid background.
  - Must stay legible and recognizable at **32×32 px** (favicon size).
  - Simple enough to trace to clean SVG (few shapes, no gradients/shadows/3D).

---

## 2. Prompt library

Copy-paste starting points. Each already carries the "no text / flat / centered /
traceable" scaffolding. Generate ~4 variations per prompt, then iterate.

**Shared suffix** (append to every prompt):
> `Flat vector logo icon, bold even line weights, no text, no letters, no words,
> single centered symbol on a plain #F9FAF4 background, high contrast, minimal
> number of shapes, no gradients, no shadows, no 3D, designed to stay legible at
> 32x32 pixels.`

Concept prompts:

1. **Confetti pin** — "A map location pin bursting with a few pieces of confetti
   shooting upward out of the top; coral (#F17A7E) pin, yellow (#FFC94B) and
   teal-slate (#4A6163) confetti."
2. **Spark marker** — "A rounded map pin with a four-point spark/star sitting at
   its center instead of the usual dot; coral pin, yellow spark."
3. **Burst-pin negative space** — "A teardrop map pin whose interior negative
   space forms a starburst; two-tone coral and cream."
4. **Radiating pin** — "A map pin with three short energy lines radiating from
   its top like it's pinging/alive; coral pin, yellow radiating lines."
5. **Confetti-only mark** — "A tight confetti burst of 5–6 simple geometric
   shapes (star, circle, triangle, squiggle) in coral, yellow, and teal-slate."
6. **Pin + pulse** — "A map pin sitting inside a single concentric 'live/now'
   pulse ring; coral pin, teal-slate ring."
7. **Rounded-square container** — repeat the strongest 2 concepts framed inside a
   rounded square tile (matches the current header treatment and app-icon shape).

Iteration prompts (reuse on the winner):
- `Same mark, simpler — reduce to the fewest shapes possible.`
- `Same mark, single color (coral #F17A7E on transparent).`
- `Same mark, thicker uniform strokes.`
- `Same composition, but balanced to sit inside a square.`

**Tool notes:**
- **DALL·E / ChatGPT:** request a transparent or solid-cream background
  explicitly; ask for "4 variations."
- **Gemini:** tends to over-decorate — lean harder on "minimal number of shapes,
  flat, no background scenery."

---

## 3. Evaluation rubric

Score each finalist candidate 1–5; a winner should clear a 4+ on the first four
rows. Silhouette rows are pass/fail gatekeepers.

| Criterion | Pass bar |
| --- | --- |
| Legible at 32px | Recognizable when shrunk to favicon size |
| One-color safe | Still reads when flattened to a single fill |
| Distinct silhouette | Not a generic stock map pin; ownable shape |
| On-palette / on-brand | Uses the palette; feels playful-local, not corporate |
| Favicon-safe | Fills the frame; no thin details that vanish |
| Traceable | Few shapes, no gradients — will vectorize cleanly |

Shrink candidates to 32px and glance from across the room — that filters most
options fast. Pick one winner (keep a runner-up).

---

## 4. Vectorization → recolor

DALL·E/Gemini output raster; the app needs SVG. Convert the winner:

1. **Trace to SVG** — Recraft's vectorize, vectorizer.ai, or Illustrator/Inkscape
   auto-trace (Inkscape: *Path → Trace Bitmap*). Prefer a tool that outputs few,
   clean paths.
2. **Simplify** — remove stray nodes/artifacts; merge shapes; aim for a small,
   hand-editable file.
3. **Recolor to exact hexes** — snap every fill to the palette values in §1 (the
   tracer will produce approximate colors; fix them by hand). Confirm it also
   works as a single coral fill for one-color contexts.
4. **Acceptance:** hand-editable SVG, small file size, crisp at 16px→512px, uses
   only palette hexes, has a sensible `viewBox` and no embedded raster.

**Fallback (if trace never gets clean):** treat the AI output as a reference
sketch only and hand-author the SVG directly from it. This is expected to be a
real possibility for a mark this small; budget for it.

---

## 5. Integration checklist

Wire the finished `logo.svg` into the app. Verify each in the dev preview.

- [ ] Add `public/logo.svg` (full mark) and, if used, `public/logo-mark.svg`
      (square/tile crop).
- [ ] Replace the emoji span in the header —
      `app/[city]/page.tsx` (~line 210): the
      `<span … bg-primary text-lg">🎉</span>` becomes the SVG (an `<img>` /
      inline SVG / Next `<Image>`), keeping the wordmark span beside it.
- [ ] Update the second header instance — the join page header in
      `app/[city]/join/page.tsx` (~line 144).
- [ ] Generate favicon assets (`favicon.ico`, `icon.png`/`apple-icon.png`) from
      the square mark and add `icons` to the `metadata` in `app/layout.tsx`
      (Next 16 also supports file-based `app/icon.svg` / `app/apple-icon.png` —
      check `node_modules/next/dist/docs/` for the current App Router convention
      before wiring, per repo AGENTS.md).
- [ ] OG image: swap/refresh any Open Graph image so the new mark appears in
      shares (the `openGraph` block in `app/layout.tsx`).
- [ ] Grep for any other `🎉` / emoji-logo usages and email header
      (`lib/email/digest.ts` uses a text `<h1>` — decide whether the email keeps
      text or gains the mark).
- [ ] Run the dev server and confirm header, favicon tab icon, and dark mode all
      look right at real sizes.

---

## 6. Execution order (TL;DR)

1. Paste brief (§1) + prompts (§2) into the AI tool → ~24 raw candidates.
2. Score with the rubric (§3) → 1 winner + 1 runner-up.
3. Iterate the winner (§2 iteration prompts) → final raster.
4. Vectorize + recolor (§4) → `logo.svg`. Fall back to hand-authoring if needed.
5. Integrate + verify (§5).
