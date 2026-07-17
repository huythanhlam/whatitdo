# Password-default auth, magic-link as per-account opt-in

**Date:** 2026-07-17
**Status:** Approved (goal-directed)

## Problem

Auth is currently passwordless-only (Supabase Auth `signInWithOtp` magic links).
Every sign-in and sign-up sends an email, which burns through email quota and
carries a cost. We want **email + password** as the default, with passwordless
magic-link login preserved as a **per-account opt-in** so email sends are rare
and deliberate.

## Constraints & context

- Supabase Auth (GoTrue) via `@supabase/ssr`. Identity is `auth.users`; app
  fields live in `public.profiles` (1:1), created by the `on_auth_user_created`
  trigger. RLS: `"own profile"` policy is `FOR ALL` `auth.uid() = id`.
- Pre-launch: no production user rows to migrate (migration 034).
- Everything downstream keys on **email** (profiles read email from
  `auth.users`, subscriptions/digest keyed on email), so email+password is the
  native fit — no separate username.
- `enable_confirmations = false` stays: password signup sends **no** confirmation
  email and establishes a session immediately.

## Decisions

- **Identifier:** email + password (Supabase native). No separate username.
- **Passwordless opt-in model:** per-account flag `magic_link_enabled`
  (default `false`), toggled in account settings. Enforced server-side.
- **Password reset:** included (reset-by-email, on-demand only).

## Design

### 1. DB — `supabase/migrations/037_password_auth.sql`
- `ALTER TABLE profiles ADD COLUMN magic_link_enabled BOOLEAN NOT NULL DEFAULT false;`
  Existing `"own profile"` RLS (`FOR ALL`, `auth.uid() = id`) already covers it.
- `CREATE FUNCTION public.magic_link_allowed(p_email text) RETURNS boolean`
  `SECURITY DEFINER SET search_path = public`. Joins `auth.users` → `profiles`,
  returns true iff an account with that (case-insensitive) email exists **and**
  has `magic_link_enabled = true`. `REVOKE ALL FROM public`, then
  `GRANT EXECUTE ... TO service_role` **only** (not `anon`) — callable solely
  from our server endpoint, so no browser-side email enumeration.

### 2. Sign-in — `components/SignInForm.tsx` (rewrite) + `app/signin/page.tsx`
Default form: email + password → `supabase.auth.signInWithPassword`. Links:
"Create an account" → `/signup`, "Forgot password?" → `/forgot-password`, and a
secondary "Email me a sign-in link instead" that POSTs `{ email }` to
`/api/auth/magic-link`. The digest opt-in checkbox is **removed** from auth forms
(it already lives at `/austin/subscribe` and the account page).

### 3. Sign-up — `app/signup/page.tsx` + `components/SignUpForm.tsx` (new)
Email + password (+ optional display name) → `supabase.auth.signUp`. No
confirmation email (config). Session established → redirect to `/onboarding`.
Optional display name written to the profile after signup.

### 4. Gated magic-link — `app/api/auth/magic-link/route.ts` (new)
`POST { email }`: service client calls `magic_link_allowed(email)`; only if
allowed does it send the OTP (`signInWithOtp`, `shouldCreateUser: false` — magic
link can never create an account). **Always returns neutral `{ ok: true }`** so
neither existence nor opt-in status leaks. Moving the send server-side is
required — the old client-side `signInWithOtp` let anyone email-bomb any address
and bypassed the flag.

### 5. Password reset (new)
- `app/forgot-password/page.tsx` + `components/ForgotPasswordForm.tsx`: email →
  `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/auth/callback?next=/reset-password })`.
  Neutral confirmation.
- `app/reset-password/page.tsx` + `components/ResetPasswordForm.tsx`: reached with
  the recovery session (after callback exchange) → `supabase.auth.updateUser({ password })`,
  then redirect to `/account`.

### 6. Callback — `app/auth/callback/route.ts` (simplify)
Still exchanges the PKCE `code` for a session (magic-link opt-in users +
recovery links). Remove the now-dead `wants_digest` metadata block. Keep the
`next` internal-path whitelist; recovery arrives with `next=/reset-password`.

### 7. Account setting
- `supabase/migrations` column already added (037).
- `app/account/page.tsx`: select `magic_link_enabled`, pass to `AccountView`.
- `components/AccountView.tsx`: "Allow signing in with a magic link" toggle,
  mirroring the personalization-opt-out toggle, saved via `PATCH /api/profile`.
- `app/api/profile/route.ts`: `PATCH` accepts `magicLinkEnabled: boolean`.
- `lib/user/data.ts`: `updateProfile` patch type gains `magic_link_enabled`.

### 8. Config & docs
- `supabase/config.toml`: add `minimum_password_length = 8`; keep
  `enable_confirmations = false`; update comments from "passwordless" to
  "password default + magic-link opt-in".
- `README.md`: update the auth bullet.

## Testing
- Vitest unit test for `/api/auth/magic-link` gating with a mocked service
  client: allowed → OTP sent; not-allowed → no send; **both return identical
  neutral response**.
- Full signup / login / reset flows verified against the local Supabase stack in
  the browser preview.

## Out of scope (deliberate)
Separate usernames, social login, migrating existing users, digest-in-auth-form,
rate-limiting beyond GoTrue's built-in.
