# AI Logo Generation Playbook — Whats Happenin

**Date:** 2026-07-20
**Status:** Design / playbook (repeatable process, not a one-off task)
**Goal:** Produce a distinctive **lockup logo** for Whats Happenin — an icon plus
the "Whats Happenin" wordmark with an "ATX" city tag beneath it — using a
general-purpose AI image generator (ChatGPT/DALL·E or Gemini) for the icon, then
finish it as a production-ready SVG wired into the app.

---

## 0. Decisions locked in

| Decision | Choice |
| --- | --- |
| Deliverable of the playbook | A **production-ready SVG** in the repo (favicon, header, OG) |
| AI tool | **ChatGPT/DALL·E or Gemini** (general-purpose, raster, weak at text) |
| Logo form | **Lockup** — icon + "Whats Happenin" wordmark + "ATX" city tag |
| Concept | **Pin-meets-burst** — a location marker fused with celebratory energy |
| Text rendering | Wordmark + city tag are **real Unbounded text**, not AI-generated |
| City tag | **"ATX" by default**, but a swappable slot (HOU for Houston, etc.) |

**Division of labor — AI draws the icon, we set the type.** DALL·E/Gemini render
text unreliably, so the AI generates *only the icon*. The "Whats Happenin"
wordmark and "ATX" tag are set as real text in the **Unbounded** font and
composed into the lockup as vectors/live text — never baked into the AI image.
This keeps the lettering crisp at every size and translatable/editable in code.

**Icon still stands alone.** The icon must work by itself (no text) because the
favicon and app tile can't fit a wordmark at 32px. So the icon is designed
first, exactly as before; the lockup wraps it.

**ATX vs. multi-city (decision needed at integration):** the app serves Austin
*and* Houston. A hard-coded "ATX" is wrong on Houston pages. The playbook treats
the city tag as a **data-driven slot** rendered from the active city (`ATX`,
`HOU`, …) so one lockup design serves every city. If you truly want a fixed
"ATX" everywhere, that's a one-line change — but the default is city-aware.

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
- **Hard constraints (every prompt — these govern the AI *icon* step):**
  - **No text, no letters, no words** in the image. (The wordmark and "ATX" tag
    are added later as real Unbounded type — see §4a Lockup assembly.)
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

Icon rows (score the icon on its own first):

| Criterion | Pass bar |
| --- | --- |
| Legible at 32px | Recognizable when shrunk to favicon size |
| One-color safe | Still reads when flattened to a single fill |
| Distinct silhouette | Not a generic stock map pin; ownable shape |
| On-palette / on-brand | Uses the palette; feels playful-local, not corporate |
| Favicon-safe | Fills the frame; no thin details that vanish |
| Traceable | Few shapes, no gradients — will vectorize cleanly |

Lockup rows (score the assembled lockup from §4a):

| Criterion | Pass bar |
| --- | --- |
| Wordmark legible | "Whats Happenin" reads cleanly at header size (~28–36px tall) |
| City tag legible | "ATX" reads without crowding the wordmark |
| Balanced | Even optical spacing; icon and type feel weighted together |
| Icon detaches | The icon still works alone when the type is dropped (favicon) |
| Swappable tag | Layout still holds when "ATX" becomes "HOU" |

Shrink candidates to 32px (icon) and to header height (lockup) and glance from
across the room — that filters most options fast. Pick one winner (keep a
runner-up).

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

## 4a. Lockup assembly (icon + wordmark + ATX)

Once the icon SVG is final, build the lockup around it. The type is real
**Unbounded**, never AI-rendered.

**Anatomy:**
- **Icon** — the vectorized mark from §4 (coral pin/burst).
- **Wordmark** — "Whats Happenin" in Unbounded, bold, tracking-tight, in
  teal-slate `#4A6163` (or cream `#F9FAF4` on dark). Matches the header's
  existing `font-display` treatment.
- **City tag** — "ATX" beneath the wordmark: smaller, letter-spaced caps, in
  coral `#F17A7E` or muted `#7C9092`. This is the swappable slot (ATX / HOU / …).

**Layouts to produce (each its own SVG):**
1. **Horizontal lockup** — icon left, wordmark right, "ATX" tucked under the
   wordmark's tail. Primary use: site header, email header, wide OG image.
2. **Stacked lockup** — icon on top, wordmark centered below, "ATX" under that.
   For square-ish placements (share cards, about page, splash).
3. **Icon only** — no type. For favicon, app tile, tight spaces (from §4).

**How the type gets into the SVG (pick one):**
- **Live text** (recommended for in-app header): keep icon as SVG/inline and
  render "Whats Happenin" + city tag as actual HTML/SVG `<text>` in Unbounded.
  Stays crisp, themeable, and lets the city tag be data-driven per city.
- **Outlined text** (for the standalone `logo.svg`, OG image, and any context
  without the font loaded): convert the Unbounded text to vector paths so it
  renders identically everywhere. Keep an editable copy with live text.

**Spacing/acceptance:** wordmark cap-height roughly matches icon height; "ATX"
baseline aligns to a clear grid; the whole lockup has even optical padding and
reads cleanly at header size (~28–36px tall) and in a wide OG frame.

---

## 5. Integration checklist

Wire the finished assets into the app. Verify each in the dev preview.

Assets to add under `public/`:
- [ ] `logo-icon.svg` — icon only (from §4), for favicon/tile and tight spaces.
- [ ] `logo.svg` — horizontal lockup (outlined Unbounded text), for OG/email.
- [ ] `logo-stacked.svg` — stacked lockup, for square placements (optional).

App wiring:
- [ ] **Header** (`app/[city]/page.tsx` ~line 210): replace the
      `<span … bg-primary text-lg">🎉</span>` with the icon SVG, and render the
      city tag as **live text driven by the active city** (`city.state`/a code
      like `ATX`) beneath/beside the existing "Whats Happenin" wordmark span.
      Prefer live text here so the tag swaps per city (ATX/HOU) and stays crisp —
      don't drop in a baked "ATX" image.
- [ ] **Second header** — the join page header in
      `app/[city]/join/page.tsx` (~line 144): same treatment.
- [ ] **Favicon / app icon**: generate `favicon.ico`, `icon.png`/`apple-icon.png`
      from `logo-icon.svg` (icon only — the wordmark is illegible at 32px) and add
      `icons` to the `metadata` in `app/layout.tsx`. Next 16 also supports
      file-based `app/icon.svg` / `app/apple-icon.png` — check
      `node_modules/next/dist/docs/` for the current App Router convention first
      (per repo AGENTS.md).
- [ ] **OG image**: use the horizontal lockup so shares show the full brand
      (the `openGraph` block in `app/layout.tsx`). If OG images are per-city,
      render the correct city tag.
- [ ] **Email header** (`lib/email/digest.ts`): it currently renders a text
      `<h1>` — decide whether to swap in the lockup SVG (remember email clients
      need PNG fallback; many strip SVG).
- [ ] Grep for any other `🎉` / emoji-logo usages.
- [ ] Run the dev server and confirm header, favicon tab icon, the ATX/HOU tag
      per city, and dark mode all look right at real sizes.

---

## 6. Execution order (TL;DR)

1. Paste brief (§1) + prompts (§2) into the AI tool → ~24 raw **icon** candidates.
2. Score icons with the rubric (§3) → 1 winner + 1 runner-up.
3. Iterate the winner (§2 iteration prompts) → final raster icon.
4. Vectorize + recolor (§4) → `logo-icon.svg`. Hand-author if trace stays messy.
5. Assemble the lockup (§4a) → icon + "Whats Happenin" + "ATX" in Unbounded →
   `logo.svg` (horizontal) and optional `logo-stacked.svg`. Score lockup rows (§3).
6. Integrate + verify (§5), with the city tag data-driven per city (ATX/HOU).
