# Recommendations Spec — Personalized Event Discovery

*Companion to [PRODUCT-SPEC.md](./PRODUCT-SPEC.md). That spec deferred user accounts "until personalization demands it" (§ "No user accounts in v1"). This document is that revisit: a plan for personalized event recommendations built from implicit and explicit signals — lightweight identity, an onboarding survey, a profile page with interests and favorites, **a single ML ranking model live at launch that continuously learns from outcomes**, and aggregate engagement metrics.*

**Scope decision: Austin-only launch.** The entire feature (tracking, For You rail, survey, profile, metrics) ships gated to Austin via a per-city allowlist (`RECS_CITIES = ['austin']` in `lib/recs/config.ts`; the rail, `/for-you`, `/api/recommendations`, and `/api/track` no-op elsewhere). Houston keeps the current chronological experience until Austin data quality justifies expansion.

---

## 0. Goals & non-goals

**Goals**

- Rank events a given person is likely to care about, and surface them in a "For You" rail, a dedicated page, and the email digest.
- **One ranking system, ML from day one:** a logistic-regression model over user-affinity, event-engagement, and embedding-similarity features. There is no separate heuristic ranker — launch weights are simply model version 1, replaced by trained versions as data accumulates.
- Capture **explicit** signals: onboarding survey (post-authentication only), editable interests, favorites (saves), "Interested" marks, hide/"not interested".
- Capture **implicit** signals: event detail views, ticket-link clickouts, searches, calendar adds, digest link clicks.
- **Learn continuously:** log every recommendation served and its outcome, retrain nightly, gate promotion on measured lift.
- **Track aggregate engagement:** daily rollups of how many people are favoriting events and marking them interesting, on an admin metrics dashboard.
- Work for anonymous visitors from the first pageview (device identity), and get better with a lightweight account.
- Stay cheap and boring: pure Postgres + TypeScript — no model server, no Python, no queues.

**Non-goals (for now)**

- Real-time model inference services, deep-learning rankers, social features (friends, follows of people), push notifications, cross-city taste transfer.

**Constraints inherited from the codebase**

1. **Dual DB driver.** Everything must run on both Supabase Postgres (`lib/db/pg.ts`) and embedded PGlite (`lib/db/pglite.ts`). That rules out Supabase Auth as the identity layer for local dev, and means migrations stick to SQL features both drivers support. The repo already uses GIN FTS and `pg_trgm`; PGlite also ships the `vector` extension, so the pgvector embedding column works locally.
2. **ISR pages.** `app/[city]/page.tsx` uses `revalidate = 900`. Personalized content must **not** render in the cached RSC payload — it is fetched client-side from an API route. This shapes the whole UI plan.
3. **No ORM.** All reads/writes go through typed functions in `lib/db/index.ts`; new features follow that pattern.
4. **Vercel cron limits.** Crons may be restricted to daily firing (Hobby plan). Anything needing freshness faster than daily is therefore **write-through** (updated inline on user actions), never cron-dependent.
5. **Existing preference seed.** `subscriptions` already stores `category_slugs`, `free_only`, `neighborhoods` per `(email, city_id)` — digest preferences merge into the new profile rather than living beside it.

---

## 1. Identity strategy (the gating decision)

Personal signals need something to attach to. Two identities, layered:

### 1.1 Anonymous device identity — no login required

- On first visit, middleware (or the first `/api/track` call) sets a signed, httpOnly cookie `wid` containing a random UUID (`anon_id`). HMAC-signed with an env secret so it can't be forged; no PII inside.
- Implicit signals, favorites, and "Interested" marks can attach to `anon_id` alone. A visitor who never signs up still gets a working "For You" rail on their device. **The onboarding survey and profile, however, are account-only (§7.5, §7.6)** — anonymous personalization is purely behavioral.
- Respect consent: the cookie is functional/first-party, but ship a "Personalization" toggle (§8) that stops tracking and clears history.

### 1.2 Lightweight account — magic link over Resend

- **Roll a minimal magic-link auth in-repo** rather than adopt Supabase Auth.
  - Why not Supabase Auth: it doesn't exist under PGlite local dev; the app connects as service role with raw `pg` anyway; and the stack already has everything needed (Resend for email, token pattern proven by `subscriptions.token` + double opt-in).
  - Flow: enter email → `auth_tokens` row (random token, 15-min expiry, single use) → Resend email with `/api/auth/verify?token=…` → set session cookie (`sessions` table, 90-day rolling expiry). No passwords ever.
- **Digest opt-in at registration:** the sign-up form includes a checkbox — *"Also email me the weekly events digest."* If checked, `/api/auth/verify` creates a `subscriptions` row (weekly frequency, the registration city, all categories by default) with `confirmed = true`: the magic link itself proves email ownership, satisfying double opt-in. Completing the survey later offers to sync chosen categories to the subscription.
- On login, **merge** the anonymous history: `UPDATE interactions/favorites/user_interests SET user_id = $user WHERE anon_id = $wid`, and auto-link any existing `subscriptions` rows by the now-verified email. Nothing is lost by browsing first and signing up later.
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
  token        TEXT PRIMARY KEY,      -- random 32-byte hex
  email        TEXT NOT NULL,
  wants_digest BOOLEAN NOT NULL DEFAULT false,  -- registration checkbox, applied at verify
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ
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
-- Explicit: favorites (the heart button; also the strongest training label)
CREATE TABLE favorites (
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id  UUID,                      -- pre-login favorites
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX favorites_user_event ON favorites (user_id, event_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX favorites_anon_event ON favorites (anon_id, event_id) WHERE anon_id IS NOT NULL;

-- Explicit: interest weights from survey + profile edits + hides.
-- Rows with source IN ('onboarding','profile') are ALWAYS user_id-keyed (survey is post-auth);
-- anon_id rows only ever hold source='derived' interests.
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

-- Implicit + explicit: append-only interaction log
CREATE TABLE interactions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  anon_id    UUID,
  city_id    INT REFERENCES cities(id),
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,           -- 'view' | 'clickout' | 'favorite' | 'unfavorite'
                                      -- | 'interested' | 'uninterested' | 'hide'
                                      -- | 'calendar_add' | 'share' | 'search' | 'digest_click'
  serve_id   UUID,                    -- links back to rec_impressions when the event was recommended
  query      TEXT,                    -- for type='search'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE INDEX interactions_actor ON interactions (user_id, created_at DESC);
CREATE INDEX interactions_anon  ON interactions (anon_id, created_at DESC);
CREATE INDEX interactions_event ON interactions (event_id);
CREATE INDEX interactions_serve ON interactions (serve_id) WHERE serve_id IS NOT NULL;
```

```sql
-- 031_ml.sql — the model's feature stores and training data
-- Per-actor taste profile; write-through EMA-updated on every tracked signal (§5 fast loop)
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

-- Event quality: Bayesian-smoothed engagement rate, write-through (real-time trending, §5)
CREATE TABLE event_engagement (
  event_id    UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  impressions INT NOT NULL DEFAULT 0, -- incremented on each recommendation serve
  engagements INT NOT NULL DEFAULT 0, -- favorites + interested + clickouts, incremented in /api/track
  score       REAL NOT NULL,          -- (engagements + k*city_avg) / (impressions + k), recomputed inline
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Content embeddings for the semantic feature (pgvector; works under PGlite too)
ALTER TABLE events ADD COLUMN embedding vector(768);  -- Gemini text-embedding, filled by tagger cron
-- User taste vector: decayed mean of engaged-event embeddings, seeded from survey categories
CREATE TABLE user_vectors (
  user_id  UUID,
  anon_id  UUID,
  vec      vector(768) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE UNIQUE INDEX user_vectors_user ON user_vectors (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_vectors_anon ON user_vectors (anon_id) WHERE anon_id IS NOT NULL;

-- Every recommendation served, with the features used to rank it: the training data.
CREATE TABLE rec_impressions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  serve_id   UUID NOT NULL,           -- one per /api/recommendations response
  user_id    UUID,
  anon_id    UUID,
  city_id    INT NOT NULL REFERENCES cities(id),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  surface    TEXT NOT NULL,           -- 'rail' | 'for_you' | 'digest'
  position   INT NOT NULL,            -- rank shown (position-bias correction needs this)
  features   JSONB NOT NULL,          -- feature vector at serve time, exactly as scored
  model_version INT NOT NULL,         -- which model_versions row ranked it
  explored   BOOLEAN NOT NULL DEFAULT false,  -- exploration slot, not exploitation
  engaged    BOOLEAN NOT NULL DEFAULT false,  -- backfilled when an interaction carries this serve_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rec_impressions_serve ON rec_impressions (serve_id);
CREATE INDEX rec_impressions_day   ON rec_impressions (created_at);

-- Versioned model coefficients; serving reads the active row. v1 = seeded priors.
CREATE TABLE model_versions (
  id           SERIAL PRIMARY KEY,
  weights      JSONB NOT NULL,        -- {bias, category_affinity, venue_affinity, price_fit, ...}
  trained_rows INT NOT NULL DEFAULT 0,  -- 0 for the seeded v1
  holdout_auc  REAL,                  -- offline evaluation; null for v1
  status       TEXT NOT NULL DEFAULT 'candidate',  -- 'candidate' | 'active' | 'shadow' | 'retired'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seed: INSERT INTO model_versions (weights, status) VALUES ('{...priors...}', 'active');
```

```sql
-- 032_metrics.sql — aggregate engagement metrics, one row per (day, city, metric)
CREATE TABLE metrics_daily (
  day     DATE NOT NULL,
  city_id INT NOT NULL REFERENCES cities(id),
  metric  TEXT NOT NULL,
  value   NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, city_id, metric)
);
```

Retention: a weekly job prunes `interactions` and `rec_impressions` older than 180 days (aggregates in `metrics_daily` persist indefinitely — they carry no per-user data) and `user_affinity`/`user_vectors`/`favorites` rows for `anon_id`s inactive 90+ days.

---

## 3. Signal inventory

Signals update the model's *features* (affinities, engagement counters, user vectors); the numbers below are the per-signal magnitudes used in those feature updates. How much each **feature** matters to the final ranking is learned by the model (§4), not hand-tuned.

| Signal | Kind | Capture point | Feature-update magnitude |
| --- | --- | --- | --- |
| Onboarding survey picks | explicit | survey (post-auth) → `user_interests` | 3.0 per category/neighborhood |
| Favorite (save) | explicit | heart on `EventCard` / detail page | 4.0 |
| "Interested" mark | explicit | star toggle on card / detail page | 2.5 |
| "Not interested" / hide | explicit | overflow menu on card | −4.0 (category −1.0 derived) |
| Profile interest edits | explicit | profile page | replaces survey weights |
| Digest prefs (`subscriptions`) | explicit | existing subscribe flow + registration checkbox | seeds `user_interests` on account link |
| Ticket clickout | implicit | `/api/track` beacon on `ticket_url` click | 3.0 |
| Calendar add | implicit | beacon on ICS/GCal button | 3.0 |
| Event detail view | implicit | beacon from detail page | 1.0 |
| Share | implicit | beacon on share button | 2.0 |
| Search query → category match | implicit | logged in `/api/events` path | 0.5 |
| Digest link click | implicit | tokenized redirect `/api/r?e=…&s=…` | 2.0 |

**Favorite vs. Interested:** the heart curates a list (shows in profile, implies intent to go); the star is a lightweight "this looks good" that costs nothing socially or organizationally. Both feed the model and both are counted in aggregate metrics (§9); only favorites build the profile list.

**Training labels:** an impression counts as `engaged` when a favorite, interested, clickout, or calendar-add interaction arrives carrying its `serve_id`.

Time decay everywhere: feature contributions decay as `exp(−age_days / 45)`, so tastes drift with behavior.

---

## 4. The ranking model

One model, one serving path, live from the first rail render. **There is no heuristic ranker** — before training data exists, the model serves seeded prior weights (`model_versions` v1); those are a model version like any other, replaced through the same promotion pipeline once nightly training produces something better.

### 4.1 Architecture

Logistic regression over a per-(actor, event) feature vector:

```
P(engaged | shown) = sigmoid(w · x + b)

x = {
  category_affinity:      max user_affinity over the event's categories,
  venue_affinity:         user_affinity(venue_norm),
  neighborhood_affinity:  via venues.neighborhood,
  price_fit:              free/price preference match,
  dow_affinity:           day-of-week match,
  engagement_prior:       event_engagement.score (Bayesian-smoothed, real-time),
  embedding_sim:          cosine(user_vectors.vec, events.embedding),
  proximity:              1 / (1 + days_until_start),
  seen_count:             prior views of this event without engaging,
}
```

- **Candidate set:** upcoming approved Austin events, next 14 days.
- **Serving:** one SQL query in `listRecommendedEvents(cityId, actor, opts)` (`lib/db/index.ts`) joining `user_affinity`, `event_engagement`, `user_vectors`/`events.embedding`, dot-multiplied against the active `model_versions.weights` row. Ranking order doesn't need the sigmoid, so serving is a plain weighted sum — indexable and fast at this catalog size. Hidden events are excluded outright, not down-weighted.
- **Post-processing in TypeScript (`lib/recs/score.ts`):** diversity re-rank (cap 3 events per category, 2 per venue in the top 20) and exploration-slot injection (§4.4).
- **Embeddings:** event `title+description` embedded with Gemini (batched into the existing tagger cron, `lib/tagger.ts` pattern → `lib/recs/embed.ts`); the user vector is a decayed mean of engaged-event embeddings, **seeded at survey completion from the centroids of chosen categories** so authenticated users get semantic personalization before any behavior exists.

### 4.2 Training (nightly, pure TypeScript)

`lib/recs/train.ts` — gradient-descent logistic regression, ~50 lines, no Python, no model server:

- **Data:** last 30 days of `rec_impressions`; features from the logged `features` JSONB (exactly what was scored — no train/serve skew), label = `engaged`. Time-based holdout (last 3 days) for evaluation.
- **Position-bias correction:** weight each example by inverse position click-propensity (estimated from the same logs), so the model doesn't learn "whatever ranked first is good."
- **Cold training set:** until impressions accumulate (~2–4 weeks of traffic), the trainer runs but refuses to promote (minimum-rows threshold). v1 priors keep serving. Nothing changes architecturally when the first trained model wins — only the weights row.

### 4.3 Promotion, gating, rollback

- Fitted coefficients land in `model_versions` as `candidate` with holdout AUC.
- **Offline replay gate:** candidate must score yesterday's engaged impressions higher than the active model did — a free check before any live traffic.
- **Shadow cohort:** candidate serves 10% of traffic (hash of `anon_id`); promote to `active` only if engagement doesn't regress against `metrics_daily` guardrails (§9). Rollback = flip `status` on one row.
- `rec_impressions.model_version` records which model ranked every impression, so lift is always measurable per version.

### 4.4 Exploration — required, not optional

A pure exploit loop collapses into a filter bubble and starves itself of training data. Reserve 2–3 of the rail's 20 slots for exploration picks — events from categories the actor hasn't engaged with, or events with few impressions — flagged `explored = true` so training knows their provenance. This also solves item cold start structurally: every new event earns exposure to prove itself. (Upgrade path: Thompson sampling over per-category Beta distributions, which self-tunes the explore/exploit balance; epsilon-greedy slots are fine at launch.)

### 4.5 Cold start

- Brand-new anonymous visitor (no affinity, no vector): the model still runs — actor features are zero, so `engagement_prior` + `proximity` dominate and the rail is honestly labeled "Trending in Austin."
- Post-survey user: category/neighborhood affinities and a seeded user vector exist immediately → real personalization from minute one. This is the main argument for the survey.

### 4.6 Future features, same model

New signals become **features, not new systems** — the training loop absorbs them without rework. First in line: item-item co-interaction ("users who saved X also saved Y" similarity to the actor's saved events), once favorite volume supports it (rule of thumb >500/wk).

---

## 5. Continuous learning loops

Four feedback loops on four timescales; together they make the system improve without manual tuning:

| Loop | Cadence | Mechanism |
| --- | --- | --- |
| **Fast — per-user taste** | per interaction, write-through | `/api/track` updates the actor's `user_affinity` rows in-transaction via exponential moving average (`new = α·signal + (1−α)·old`) and nudges their `user_vectors` mean. Two comedy saves shift the rail within the same session. |
| **Fast — event quality** | per interaction + per serve, write-through | Each tracked engagement increments `event_engagement.engagements` and recomputes the Bayesian score inline; each recommendation serve increments `impressions`. Trending is effectively **real-time** with no cron dependency (which also sidesteps Vercel Hobby-plan cron frequency limits). New events start at the city-average prior; heavily-shown-but-ignored events get demoted — raw popularity counts can never do that. |
| **Slow — model weights** | nightly cron | Retrain on fresh impressions (§4.2); candidate → replay gate → shadow cohort → promote or discard (§4.3). Nightly batch also applies time decay and drift repair to affinities/vectors/engagement. |
| **Governance — is it working** | weekly | `metrics_daily` trend review (§9); per-model-version lift comparison; auto-rollback on guardrail regression. |

---

## 6. API surface (App Router route handlers, existing conventions)

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/track` | POST | cookie (anon ok) | Beacon endpoint for signals. `navigator.sendBeacon`-friendly, rate-limited via `lib/rateLimit.ts`, fire-and-forget 204. Accepts optional `serve_id` (marks the impression engaged). Performs the write-through updates: affinity EMA, user vector, event engagement. Validates `type` allowlist; drops when opted out. |
| `/api/recommendations` | GET | cookie (anon ok) | `?city=austin&limit=20` → model-ranked, diversity-re-ranked `EnrichedEvent[]` + `serve_id`; logs one `rec_impressions` row per item and increments engagement impressions. `Cache-Control: private, no-store`. |
| `/api/favorites` | GET/POST/DELETE | cookie (anon ok) | List / add / remove favorites; `interested` marks share the handler (`?type=`). |
| `/api/profile` | GET/PATCH | session | Read/update interests, display name, home city, opt-out flag. |
| `/api/auth/request` | POST | — | Email + `wants_digest` checkbox in → magic link out (Resend). Rate-limited. |
| `/api/auth/verify` | GET | token | Consumes token, creates user + session, merges anon history, creates confirmed digest subscription if `wants_digest`, redirects to onboarding or back-path. |
| `/api/auth/logout` | POST | session | Clears session. |
| `/api/r` | GET | token | Digest click-tracking redirect (logs `digest_click`, 302 to event). |
| `/api/admin/metrics` | GET | cron auth | `metrics_daily` time series for the dashboard (§9). |
| `/api/cron/train` | POST | cron auth | Nightly: retrain, evaluate, gate (§4.2–4.3); decay/drift repair; weekly pruning. |
| `/api/cron/metrics` | POST | cron auth | Nightly: roll yesterday into `metrics_daily`. |

Server components keep calling `lib/db` directly; only the browser goes through these routes. No hourly crons exist — everything user-facing is write-through (§0 constraint 4).

---

## 7. UI surfaces

### 7.1 "For You" rail on the city home (Austin only)

- New client component `components/ForYouRail.tsx`, rendered inside the existing ISR page shell for allowlisted cities. Fetches `/api/recommendations` on mount (the page's 900s cache is untouched because personalization never enters the RSC payload). Skeleton → horizontally scrollable card rail, reusing `EventCard`.
- Header logic: "For You" when the actor has affinity rows, "Trending in Austin" otherwise. Each card gets Save (heart), Interested (star), and an overflow *Not interested*.

### 7.2 `/[city]/for-you` page

Full-page personalized feed (client-fetched grid, same `EventGrid`), linked from the rail's "See all". Empty state routes signed-in users to the onboarding survey, anonymous users to sign-in.

### 7.3 Save & Interested everywhere

Heart (favorite) and star (interested) toggles on `components/EventCard.tsx` and the event detail page; optimistic UI, POST `/api/favorites`, work logged-out (anon), with a subtle "sign in to keep these across devices" nudge after the 3rd anonymous mark.

### 7.4 Sign-in / registration page

`app/signin/page.tsx`: email field + **"Also email me the weekly events digest"** checkbox (§1.2) + magic-link flow. Post-verify, first-time users land on the survey.

### 7.5 Onboarding survey — authenticated users only

Route: `app/onboarding/page.tsx`, session-gated; entered after first login (and linkable anytime from the profile). Anonymous visitors never see it — their personalization is implicit-only until they register. Three skippable steps, ~30 seconds total:

1. **What are you into?** — chip multi-select of the 11 `lib/categories.ts` categories (min 0, suggest 3+).
2. **Where & how much?** — Austin neighborhood multi-select (distinct `venues.neighborhood` values) + "mostly free events" toggle + typical nights out (day-of-week chips).
3. **Anything you already love?** — top ~12 upcoming high-engagement events as save-able cards (seeds favorites + venue affinity).

Writes `user_interests` (source `'onboarding'`, always `user_id`-keyed), seeds the user vector from chosen-category centroids, stamps `users.onboarded_at`. Skipping stamps it too — never nag twice. Completion offers to sync category picks to the digest subscription if one exists.

### 7.6 Profile page

Route: `app/account/page.tsx` (session-gated, redirect to sign-in otherwise). Sections:

- **Interests** — the same chips/toggles as the survey, always editable (writes source `'profile'`, which overrides `'onboarding'` weights).
- **Favorites** — saved events, upcoming first, past ones grayed; unsave inline. **Interested** subsection below it.
- **Hidden** — "not interested" list with undo.
- **Email digest** — the linked `subscriptions` rows (frequency, categories, free-only, neighborhoods) edited in one place; interest changes offer to sync.
- **Privacy** — personalization opt-out toggle, "clear my history" (deletes `interactions`, `rec_impressions` actor rows, `user_affinity`, `user_vectors`), "delete account".

### 7.7 Admin metrics dashboard

Section on the existing `app/[city]/admin/page.tsx` (cron-auth gated, same as moderation): time-series charts (last 30/90 days) from `/api/admin/metrics` — favorites and interested marks per day, unique engaging users, rail CTR by model version, survey completion. Plain SVG sparklines, no new dependencies. Optionally shows live "today so far" counts computed directly from `interactions` on page load (an indexed one-day count) rather than pre-aggregating.

### 7.8 Personalized digest

`lib/email/digest.ts` currently filters by `subscriptions.category_slugs`; for subscribers with a linked `users` row, switch selection to `listRecommendedEvents` (surface `'digest'` impressions) and route links through `/api/r`. The digest is the retention loop; this is where recs pay for themselves.

---

## 8. Privacy & consent

- Signed httpOnly first-party cookie; no third-party trackers; no PII in the interaction log beyond the actor key.
- Visible **opt-out** (profile + footer link for anon users) that stops `/api/track` writes and clears the actor's rows.
- Retention limits (§2); account deletion cascades everything; digest unsubscribe unaffected. `metrics_daily` stores only anonymous aggregates.
- Update the privacy note on the subscribe page to describe on-site personalization.

---

## 9. Aggregate metrics

The `/api/cron/metrics` nightly rollup writes one row per `(day, city, metric)` to `metrics_daily`. Nightly is deliberate: the table is day-grained and admin-facing, and nothing user-facing reads it — trending freshness comes from the write-through `event_engagement` loop (§5), not from this table. Launch metric set:

| Metric | Definition |
| --- | --- |
| `favorites_added` | count of `type='favorite'` interactions that day |
| `unique_favoriters` | distinct actors (user_id or anon_id) who favorited |
| `interested_marks` | count of `type='interested'` interactions |
| `unique_interested` | distinct actors who marked interested |
| `hides` | count of `type='hide'` |
| `clickouts` | count of `type='clickout'` |
| `rail_impressions` / `rail_engagements` / `rail_ctr` | from `rec_impressions` (surface `rail`/`for_you`), split by `model_version` and `explored` |
| `digest_clicks` | count of `type='digest_click'` |
| `signups` / `survey_completions` / `survey_skips` | from `users.created_at` / `onboarded_at` |
| `active_actors` | distinct actors with any interaction (DAU proxy) |

Surfaced on the admin dashboard (§7.7) and queryable via `/api/admin/metrics`. These are also the **guardrail metrics for model promotion** (§4.3): a candidate that tanks `favorites_added` or `rail_ctr` never leaves the shadow cohort. Because impressions carry `model_version`, personalization lift is a `metrics_daily` query, not a separate system.

---

## 10. Rollout

The ML ranker is present from the first rail render (serving v1 prior weights); phases sequence *surfaces*, not ranking systems:

| Phase | Scope | Effort |
| --- | --- | --- |
| **1 — Identity, tracking, impressions (Austin)** | `wid` cookie, `interactions` + `/api/track` with write-through affinity/engagement updates, beacons (view/clickout/share/calendar), event embeddings in the tagger cron, `rec_impressions` + seeded `model_versions` v1 | ~1 wk |
| **2 — Model serving & For You** | `listRecommendedEvents` (model dot-product + diversity + exploration slots), `/api/recommendations`, For You rail + `/for-you`, Save + Interested buttons, hide action | ~1–1.5 wk |
| **3 — Accounts & explicit prefs** | magic-link auth with digest checkbox, anon→user merge + email-linked subscriptions, onboarding survey (post-auth, seeds vectors), profile page (interests/favorites/interested/hidden/privacy) | ~1.5 wk |
| **4 — Learning & measurement** | `/api/cron/train` (retrain + replay gate + shadow cohort), `/api/cron/metrics` rollup, admin dashboard, personalized digest + `/api/r`; first trained model promotes itself once the minimum-rows threshold is met | ~1 wk |

Each phase ships independently and degrades gracefully: no cookie → trending (the same model with zero actor features); no survey → implicit-only; no account → device-local personalization; not enough training data yet → v1 priors keep serving.

---

## 11. Testing

- **Serving tests** (Vitest + PGlite, colocated per repo convention): seed synthetic actors/events + a weights row, assert ordering — category-affinity user sees their category first; hidden events excluded; zero-feature actor gets engagement-prior order; exploration slots present and flagged; diversity caps hold.
- **Training tests:** `lib/recs/train.ts` recovers known weights from synthetic impressions; position weighting applied; minimum-rows threshold blocks premature promotion; candidate never auto-promotes on AUC regression.
- **Write-through tests:** a tracked favorite updates `user_affinity`, `user_vectors`, and `event_engagement` in one transaction; opt-out short-circuits all of it.
- **Metrics tests:** rollup produces correct counts/distincts from a seeded interaction log; idempotent re-runs.
- **Merge tests:** anon history re-keys to `user_id` on login; double-login idempotent; `wants_digest` creates exactly one confirmed subscription.
- **API tests:** `/api/track` allowlist + rate limit; `/api/recommendations` never 500s for unknown actors and always returns a `serve_id`.
- **Auth tests:** token single-use, expiry, session rotation.

---

## 12. File-by-file change map

| Area | Files |
| --- | --- |
| Migrations | `supabase/migrations/029_users_auth.sql`, `030_signals.sql`, `031_ml.sql`, `032_metrics.sql` |
| DB layer | `lib/db/index.ts` (+`listRecommendedEvents`, favorites/interests/interactions/impressions/auth CRUD), `lib/recs/score.ts` (feature vector, dot-product ranking, diversity, exploration), `lib/recs/train.ts` (logistic regression, replay gate), `lib/recs/affinity.ts` (write-through EMA + decay batch), `lib/recs/embed.ts` (Gemini embeddings, user vectors), `lib/recs/config.ts` (`RECS_CITIES`, v1 prior weights), `lib/auth/session.ts` (magic link, sessions, `wid` cookie helpers) |
| API | `app/api/track/route.ts`, `app/api/recommendations/route.ts`, `app/api/favorites/route.ts`, `app/api/profile/route.ts`, `app/api/auth/{request,verify,logout}/route.ts`, `app/api/r/route.ts`, `app/api/cron/{train,metrics}/route.ts`, `app/api/admin/metrics/route.ts` |
| UI | `components/ForYouRail.tsx`, `components/SaveButton.tsx` (heart + star), `components/NotInterestedMenu.tsx`, `components/TrackBeacon.tsx`, `components/AdminMetrics.tsx`, edits to `EventCard.tsx` + event detail page + `app/[city]/admin/page.tsx` |
| Pages | `app/[city]/for-you/page.tsx`, `app/onboarding/page.tsx`, `app/account/page.tsx`, `app/signin/page.tsx` |
| Email | `lib/email/digest.ts` (personalized selection, `/api/r` links) |
| Infra | `vercel.json` (nightly crons), `.env` (+`AUTH_SECRET`), `lib/types.ts` (new types) |
