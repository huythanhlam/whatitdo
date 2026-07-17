# Recommendations Spec — Personalized Event Discovery

*Companion to [PRODUCT-SPEC.md](./PRODUCT-SPEC.md). That spec deferred user accounts "until personalization demands it" (§ "No user accounts in v1"). This document is that revisit: a phased plan for personalized event recommendations built from implicit and explicit signals, including lightweight identity, an onboarding survey, and a profile page with interests and favorites.*

---

## 0. Goals & non-goals

**Goals**

- Rank events a given person is likely to care about, and surface them in a "For You" rail, a dedicated page, and the email digest.
- Capture **explicit** signals: onboarding survey, editable interests, favorites (saves), hide/"not interested".
- Capture **implicit** signals: event detail views, ticket-link clickouts, searches, calendar adds, digest link clicks.
- Work for anonymous visitors from the first pageview (device identity), and get better with a lightweight account.
- Stay cheap and boring: heuristic SQL scoring first; no ML infrastructure until interaction volume justifies it.

**Non-goals (for now)**

- Real-time / per-request model inference, collaborative filtering at launch, social features (friends, follows of people), push notifications, cross-city taste transfer.

**Constraints inherited from the codebase**

1. **Dual DB driver.** Everything must run on both Supabase Postgres (`lib/db/pg.ts`) and embedded PGlite (`lib/db/pglite.ts`). That rules out Supabase Auth as the identity layer for local dev, and means migrations must stick to plain SQL features both drivers support (the repo already uses GIN FTS and `pg_trgm`, so those are safe).
2. **ISR pages.** `app/[city]/page.tsx` uses `revalidate = 900`. Personalized content must therefore **not** render in the cached RSC payload — it has to be fetched client-side from an API route (or a separate dynamic segment). This shapes the whole UI plan.
3. **No ORM.** All reads/writes go through typed functions in `lib/db/index.ts`; new features follow that pattern.
4. **Existing preference seed.** `subscriptions` already stores `category_slugs`, `free_only`, `neighborhoods` per `(email, city_id)` — the digest preferences merge into the new profile rather than living beside it.

---

## 1. Identity strategy (the gating decision)

Personal signals need something to attach to. Two identities, layered:

### 1.1 Anonymous device identity — Phase 1, no login required

- On first visit, middleware (or the first `/api/track` call) sets a signed, httpOnly cookie `wid` containing a random UUID (`anon_id`). HMAC-signed with an env secret so it can't be forged; no PII inside.
- All implicit signals and even favorites/interests can attach to `anon_id` alone. A visitor who never signs up still gets a working "For You" rail on their device.
- Respect consent: the cookie is functional/first-party, but ship a "Personalization" toggle (see §8) that stops tracking and clears history.

### 1.2 Lightweight account — magic link over Resend — Phase 2

- **Recommendation: roll a minimal magic-link auth in-repo** rather than adopt Supabase Auth.
  - Why not Supabase Auth: it doesn't exist under PGlite local dev; the app connects as service role with raw `pg` anyway; and the stack already has everything needed (Resend for email, token pattern proven by `subscriptions.token` + double opt-in).
  - Flow: enter email → `auth_tokens` row (random token, 15-min expiry, single use) → Resend email with `/api/auth/verify?token=…` → set session cookie (`sessions` table, 90-day rolling expiry). No passwords ever.
- On login, **merge** the anonymous history: `UPDATE interactions/favorites/user_interests SET user_id = $user WHERE anon_id = $wid`, and link any existing `subscriptions` rows by email. Nothing is lost by browsing first and signing up later.
- The `subscriptions.user_id` FK to `auth.users` (unused today) is dropped/re-pointed to the new `users` table in the same migration.

---

## 2. Data model (new migrations, `029_…` onward)

```sql
-- 029_users_auth.sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  display_name TEXT,
  home_city_id INT REFERENCES cities(id),
  onboarded_at TIMESTAMPTZ,           -- null until survey completed/skipped
  personalization_opt_out BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_tokens (
  token      TEXT PRIMARY KEY,        -- random 32-byte hex
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,        -- random 32-byte hex, stored in cookie
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

```sql
-- 030_signals.sql
-- Explicit: favorites (the heart button; doubles as strongest implicit signal)
CREATE TABLE favorites (
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id  UUID,                      -- pre-login favorites
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX favorites_user_event ON favorites (user_id, event_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX favorites_anon_event ON favorites (anon_id, event_id) WHERE anon_id IS NOT NULL;

-- Explicit: interest weights from survey + profile edits + hides
CREATE TABLE user_interests (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id     UUID,
  kind        TEXT NOT NULL,          -- 'category' | 'neighborhood' | 'venue' | 'price'
  value       TEXT NOT NULL,          -- category slug, neighborhood name, venue_norm, 'free_only'
  weight      REAL NOT NULL DEFAULT 1.0,  -- negative = "not interested"
  source      TEXT NOT NULL,          -- 'onboarding' | 'profile' | 'derived'
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX user_interests_user ON user_interests (user_id, kind, value) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_interests_anon ON user_interests (anon_id, kind, value) WHERE anon_id IS NOT NULL;

-- Implicit: append-only interaction log
CREATE TABLE interactions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id    UUID,
  city_id    INT REFERENCES cities(id),
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,           -- 'view' | 'clickout' | 'favorite' | 'unfavorite'
                                      -- | 'hide' | 'calendar_add' | 'share' | 'search' | 'digest_click'
  query      TEXT,                    -- for type='search'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE INDEX interactions_actor ON interactions (user_id, created_at DESC);
CREATE INDEX interactions_anon  ON interactions (anon_id, created_at DESC);
CREATE INDEX interactions_event ON interactions (event_id);
```

```sql
-- 031_affinity.sql — precomputed taste profile, refreshed by cron (§5)
CREATE TABLE user_affinity (
  user_id  UUID,
  anon_id  UUID,
  kind     TEXT NOT NULL,             -- 'category' | 'venue' | 'neighborhood' | 'price' | 'dow'
  value    TEXT NOT NULL,
  score    REAL NOT NULL,             -- normalized 0..1 (or negative for hides)
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX user_affinity_user ON user_affinity (user_id, kind, value) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_affinity_anon ON user_affinity (anon_id, kind, value) WHERE anon_id IS NOT NULL;

-- City-level popularity prior for cold start (also cron-refreshed)
CREATE TABLE event_popularity (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  score    REAL NOT NULL,             -- decayed interaction count, all users
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Retention: a weekly cron prunes `interactions` older than 180 days and `user_affinity`/`favorites` rows for `anon_id`s inactive 90+ days.

---

## 3. Signal inventory & weights

| Signal | Kind | Capture point | Base weight |
| --- | --- | --- | --- |
| Onboarding survey picks | explicit | survey → `user_interests` | 3.0 per category/neighborhood |
| Favorite (save) | explicit | heart on `EventCard` / detail page | 4.0 |
| "Not interested" / hide | explicit | overflow menu on card | −4.0 (category −1.0 derived) |
| Profile interest edits | explicit | profile page | replaces survey weights |
| Digest prefs (`subscriptions`) | explicit | existing subscribe flow | seeds `user_interests` on account link |
| Ticket clickout | implicit | `/api/track` beacon on `ticket_url` click | 3.0 |
| Calendar add | implicit | beacon on ICS/GCal button | 3.0 |
| Event detail view | implicit | beacon from detail page RSC shell | 1.0 |
| Share | implicit | beacon on share button | 2.0 |
| Search query → category match | implicit | logged in `/api/events` path | 0.5 |
| Digest link click | implicit | tokenized redirect `/api/r?e=…&s=…` | 2.0 |

Time decay: signal contribution × `exp(−age_days / 45)` when affinity is recomputed, so tastes drift with behavior.

---

## 4. Ranking algorithm (phased)

### Phase A — content-based heuristic scoring, pure SQL (launch)

A new `listRecommendedEvents(cityId, actor, opts)` in `lib/db/index.ts`, same enrichment helpers (`CATEGORIES_JSON`/`enrichRow`) as `listEvents`. Candidate set = upcoming approved events in city, next 14 days. Score per event:

```
score =
    2.0 * max(category_affinity over event's categories)
  + 1.0 * venue_affinity(venue_norm)
  + 0.8 * neighborhood_affinity (via venues.neighborhood)
  + 0.5 * price_fit (free affinity vs is_free / price_min)
  + 0.3 * day_of_week_affinity
  + 0.5 * normalized event_popularity          -- prior, dominates for cold users
  + 0.4 * proximity boost: 1 / (1 + days_until_start)
  − 6.0 * hidden (explicit hide of this event → effectively excluded)
  − seen_penalty: 0.5 if already viewed 3+ times without saving
```

All terms come from one `JOIN` against `user_affinity` + `event_popularity` — a single query, no N+1, indexable, fine at this catalog size (thousands of upcoming events per city). Diversity pass in TypeScript afterward: cap 3 events per category and 2 per venue in the top 20 (simple greedy re-rank).

### Phase B — item-item co-interaction (when data supports it)

When weekly favorite volume is meaningful (rule of thumb: >500 favorites/wk/city): nightly cron computes "users who saved X also saved Y" pairs into an `event_similarity` table; blend `+ 1.5 * max_similarity_to_saved_events` into the score. Still SQL, still no model server.

### Phase C — optional semantic layer (pgvector)

PRODUCT-SPEC already floats pgvector for search. If adopted: embed event title+description (Gemini embeddings, batched in the tagger cron), user vector = decayed weighted mean of interacted-event vectors, blend cosine similarity as one more score term. **Only if** Phases A/B measurably plateau; PGlite supports the `vector` extension, so local dev survives.

### Cold start

- Brand-new anonymous visitor: `event_popularity` + image-having + soon-happening ordering — i.e., "Trending" labeled as such, not fake personalization.
- Post-survey user: category/neighborhood affinities exist immediately → real personalization from minute one. This is the main argument for the survey.

---

## 5. Pipeline & cron

Follow the existing cron convention (`vercel.json` + `requireCronAuth`):

- **`/api/cron/affinity` (hourly):** recompute `user_affinity` for actors with new interactions since last run (incremental, keyed off `interactions.id` watermark), full decay recompute nightly. Recompute `event_popularity` (global decayed counts).
- **Pruning** piggybacks on the nightly run (§2 retention).

No queues, no streaming — batch is plenty at this scale.

---

## 6. API surface (App Router route handlers, existing conventions)

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/track` | POST | cookie (anon ok) | Beacon endpoint for implicit signals. `navigator.sendBeacon`-friendly, rate-limited via `lib/rateLimit.ts`, fire-and-forget 204. Validates `type` against allowlist; drops when `personalization_opt_out`. |
| `/api/recommendations` | GET | cookie (anon ok) | `?city=austin&limit=20` → scored, diversity-ranked `EnrichedEvent[]`. `Cache-Control: private, no-store`. Falls back to trending for unknown actors. |
| `/api/favorites` | GET/POST/DELETE | cookie (anon ok) | List / add / remove favorites. |
| `/api/profile` | GET/PATCH | session | Read/update interests, display name, home city, opt-out flag. |
| `/api/auth/request` | POST | — | Email in → magic link out (Resend). Rate-limited. |
| `/api/auth/verify` | GET | token | Consumes token, creates session, merges anon history, redirects to onboarding or back-path. |
| `/api/auth/logout` | POST | session | Clears session. |
| `/api/r` | GET | token | Digest click-tracking redirect (logs `digest_click`, 302 to event). |

Server components keep calling `lib/db` directly; only the browser goes through these routes.

---

## 7. UI surfaces

### 7.1 "For You" rail on the city home

- New client component `components/ForYouRail.tsx`, rendered inside the existing ISR page shell. Fetches `/api/recommendations` on mount (the page's 900s cache is untouched because personalization never enters the RSC payload). Skeleton → horizontally scrollable card rail, reusing `EventCard`.
- Header logic: "For You" when the actor has affinity rows, "Trending in Austin" otherwise. Each card gets an overflow menu: *Save*, *Not interested*.

### 7.2 `/[city]/for-you` page

Full-page personalized feed (client-fetched grid, same `EventGrid`), linked from the rail's "See all". Empty state routes to the onboarding survey.

### 7.3 Save button everywhere

Heart toggle added to `components/EventCard.tsx` and the event detail page; optimistic UI, POSTs `/api/favorites`, works logged-out (anon), with a subtle "sign in to keep these across devices" nudge after the 3rd anonymous save.

### 7.4 Onboarding survey

Route: `app/onboarding/page.tsx`, entered after first login (and linkable anytime). Three skippable steps, ~30 seconds total:

1. **What are you into?** — chip multi-select of the 11 `lib/categories.ts` categories (min 0, suggest 3+).
2. **Where & how much?** — neighborhood multi-select (from `venues.neighborhood` distinct values per city) + "mostly free events" toggle + typical nights out (day-of-week chips).
3. **Anything you already love?** — top ~12 upcoming popular events as save-able cards (seeds favorites + venue affinity).

Writes `user_interests` (source `'onboarding'`), stamps `users.onboarded_at`. Skipping stamps it too — never nag twice.

### 7.5 Profile page

Route: `app/account/page.tsx` (session-gated, redirect to sign-in otherwise). Sections:

- **Interests** — the same chips/toggles as the survey, always editable (writes source `'profile'`, which overrides `'onboarding'` weights).
- **Favorites** — saved events, upcoming first, past ones grayed; unsave inline.
- **Hidden** — "not interested" list with undo.
- **Email digest** — surfaces the linked `subscriptions` rows (frequency, categories, free-only, neighborhoods) so digest prefs and recs prefs are edited in one place; interests changes offer to sync to the digest.
- **Privacy** — personalization opt-out toggle, "clear my history" (deletes `interactions` + `user_affinity`), "delete account".

### 7.6 Personalized digest upgrade

`lib/email/digest.ts` currently filters by `subscriptions.category_slugs`; for subscribers with a linked `users` row, switch selection to `listRecommendedEvents` and route links through `/api/r` for click tracking. The digest is the retention loop; this is where recs pay for themselves.

---

## 8. Privacy & consent

- Signed httpOnly first-party cookie; no third-party trackers; no PII in the interaction log beyond the actor key.
- Visible **opt-out** (profile + footer link for anon users) that stops `/api/track` writes and clears the actor's rows.
- Retention limits (§2), account deletion cascades everything, digest unsubscribe unaffected.
- Update the privacy note on the subscribe page to describe on-site personalization.

---

## 9. Measurement

Log `rail_impression` interactions with a `variant` flag (chronological vs personalized — simple hash-based 50/50 by `anon_id` at launch). Weekly cron rollup into a tiny `metrics_daily` table:

- For You rail CTR vs baseline hero/grid CTR
- Save rate per session; % sessions with ≥1 clickout
- Digest CTR: personalized vs category-filtered cohorts
- Survey completion + skip rates

Ship the rail behind the A/B flag; promote when CTR wins.

---

## 10. Phased rollout

| Phase | Scope | Effort |
| --- | --- | --- |
| **1 — Signals & trending** | `wid` cookie, `interactions` + `/api/track`, beacons (view/clickout/share/calendar), `event_popularity` cron, "Trending" rail (popularity-ranked, no identity needed to render) | ~1 wk |
| **2 — Anonymous personalization** | `user_interests`/`user_affinity` + affinity cron, `listRecommendedEvents` scorer + diversity re-rank, `/api/recommendations`, For You rail + `/for-you` page, save button + `favorites`, hide action | ~1–1.5 wk |
| **3 — Accounts & explicit prefs** | magic-link auth (`users`/`sessions`/`auth_tokens`), anon→user merge, onboarding survey, profile page (interests/favorites/hidden/privacy), digest linking | ~1.5 wk |
| **4 — Digest personalization & measurement** | personalized digest selection, `/api/r` click tracking, A/B flag + metrics rollup | ~0.5 wk |
| **5 — Smarter ranking (conditional)** | item-item co-interaction blend; pgvector semantic term if warranted | later |

Each phase ships independently and degrades gracefully: no cookie → trending; no survey → implicit-only; no account → device-local personalization.

---

## 11. Testing

- **Scorer unit tests** (Vitest + PGlite, colocated per repo convention): seed synthetic actors/events, assert ordering — category-affinity user sees their category first; hidden events excluded; cold actor gets popularity order; decay demotes stale interests.
- **Merge tests:** anon history correctly re-keys to `user_id` on login; double-login idempotent.
- **API tests:** `/api/track` allowlist + rate limit + opt-out short-circuit; `/api/recommendations` never 500s for unknown actors.
- **Auth tests:** token single-use, expiry, session rotation.

---

## 12. File-by-file change map

| Area | Files |
| --- | --- |
| Migrations | `supabase/migrations/029_users_auth.sql`, `030_signals.sql`, `031_affinity.sql` |
| DB layer | `lib/db/index.ts` (+`listRecommendedEvents`, favorites/interests/interactions/auth CRUD), `lib/recs/score.ts` (scoring SQL + diversity re-rank), `lib/recs/affinity.ts` (cron recompute), `lib/auth/session.ts` (magic link, sessions, `wid` cookie helpers) |
| API | `app/api/track/route.ts`, `app/api/recommendations/route.ts`, `app/api/favorites/route.ts`, `app/api/profile/route.ts`, `app/api/auth/{request,verify,logout}/route.ts`, `app/api/r/route.ts`, `app/api/cron/affinity/route.ts` |
| UI | `components/ForYouRail.tsx`, `components/SaveButton.tsx`, `components/NotInterestedMenu.tsx`, `components/TrackBeacon.tsx` (fire-on-mount view beacon), edits to `EventCard.tsx` + event detail page |
| Pages | `app/[city]/for-you/page.tsx`, `app/onboarding/page.tsx`, `app/account/page.tsx`, `app/signin/page.tsx` |
| Email | `lib/email/digest.ts` (personalized selection, `/api/r` links) |
| Infra | `vercel.json` (affinity cron), `.env` (+`AUTH_SECRET`), `lib/types.ts` (new types) |

---

## 13. Open questions

1. **Survey timing for anonymous users** — offer the survey pre-account (writes to `anon_id`) or only post-login? Plan assumes post-login, with anonymous personalization purely implicit; flipping this is cheap if anon survey conversion looks attractive.
2. **Neighborhood coverage** — `venues.neighborhood` fill rate varies by city; if sparse for Houston, drop the neighborhood survey step there rather than show empty options.
3. **Digest identity merge** — auto-link `subscriptions` rows by matching email on account creation (proposed), or require explicit confirmation?
