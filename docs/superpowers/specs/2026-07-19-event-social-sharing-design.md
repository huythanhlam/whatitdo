# Event social & email sharing — design

## Goal

Let visitors share a specific event to social media (Facebook Messenger,
WhatsApp, Instagram, X/Twitter, TikTok, etc.) or email, from the event detail
page.

## Scope

- Share affordance on the **event detail page only** (`app/[city]/events/[id]/page.tsx`).
- **Smart-hybrid** UI: native share sheet where available, plus explicit
  per-platform web buttons as an always-present fallback.
- Shares are tracked as a `share` recommendation signal (the interaction type
  already exists in `lib/recs/config.ts`, magnitude 2.0).

## Platform reality

Instagram, TikTok, and Facebook Messenger have **no web "share this link" URL
scheme** you can deep-link from a page. They are only reachable through the
device's native share sheet (`navigator.share`), which lists them on mobile.
WhatsApp, X/Twitter, Facebook (feed), and email **do** have web intent URLs.

The design splits along this line: explicit web buttons for the platforms with
real intents; the native sheet for the app-only ones.

## Components

### 1. `lib/share.ts` (pure, unit-tested)

No React, no side effects — string construction only, covered by
`lib/share.test.ts` (vitest, matching repo convention).

- `shareText(title: string): string` → caption, e.g. `Check out {title}`.
- `buildShareTargets({ url, title }): ShareTarget[]` → ordered array of
  `{ id, label, href }` for web-intent platforms:
  - WhatsApp → `https://wa.me/?text=<text + url>`
  - X/Twitter → `https://twitter.com/intent/tweet?text=<text>&url=<url>`
  - Facebook → `https://www.facebook.com/sharer/sharer.php?u=<url>`
  - Email → `mailto:?subject=<title>&body=<text>%0A%0A<url>`

All parameters are `encodeURIComponent`-escaped. Copy-link and native share are
handled in the component (they are actions, not hrefs).

### 2. `components/ShareButton.tsx` (client island)

Props: `{ url: string; title: string; city: string; eventId: string }`.

- Renders an outline "Share" button consistent with the detail-page button row.
- Clicking toggles a small self-contained popover: absolutely-positioned menu,
  closes on outside-click and Escape, `role="menu"` / `role="menuitem"`, focus
  ring — no new dependency (Radix has no popover primitive here).
- Popover contents, top to bottom:
  - **"More apps…"** — rendered only when `navigator.share` exists (mobile);
    invokes the native sheet → reaches Instagram / TikTok / Messenger.
  - **WhatsApp · X · Facebook · Email** — open the intent URL via
    `window.open(href, '_blank', 'noopener')`.
  - **Copy link** — `navigator.clipboard.writeText(url)` with a transient
    "Copied!" state; falls back silently if clipboard is unavailable.
- Every path fires `track('share', { eventId, city })` via the existing beacon
  helper (`lib/track.ts`). The `/api/track` route already accepts `share`;
  it records for signed-in Austin users and drops others harmlessly.

### 3. Wiring — `app/[city]/events/[id]/page.tsx`

Add `<ShareButton>` to the existing button row (next to "🔔 Get event alerts"),
passing:
- `url = ${getBaseUrl()}/${citySlug}/events/${event.id}`
- `title = event.title`
- `city = citySlug`, `eventId = event.id`

## Facebook Messenger decision

True web Messenger sharing needs a Facebook App ID (extra env/config). Default:
use the standard **Facebook share** web button (no config, works everywhere) as
the explicit button, and rely on the **native share sheet** to reach Messenger
directly on mobile. No `FACEBOOK_APP_ID` is introduced.

## Testing

- `lib/share.test.ts`: asserts each target's host, that text/url are present and
  correctly encoded, and target ordering.
- Preview-browser verification: the popover and explicit buttons are fully
  drivable without a real native sheet or clipboard.

## Non-goals

- No share buttons on event cards (detail page only).
- No new dependencies, no `FACEBOOK_APP_ID`.
- No server-side share endpoint — sharing is client-only plus the existing
  tracking beacon.
