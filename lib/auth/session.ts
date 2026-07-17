import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

// Anonymous device identity — the `wid` cookie.
//
// Personalization signals need something to attach to before anyone signs in.
// On first request we mint a random UUID and store it in a signed, httpOnly
// cookie; every implicit signal carries this `anon_id`. When the person later
// creates an account, their anon history is repointed to the user (a later
// phase). No PII is in the cookie — just an opaque id and an HMAC that stops it
// being forged or swapped for someone else's.
//
// The account session cookie (opaque `sessions.id`) is a separate concern added
// with the auth routes; this module is only the anonymous layer.

export const WID_COOKIE = 'wid'
export const WID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 // one year

// The signing key. A dedicated secret in production; a fixed dev fallback so the
// zero-config local flow works with no env set. This signs an anonymous id, not
// a credential, so the fallback is a low-risk convenience — but production should
// set AUTH_SECRET (a rotated secret invalidates existing anon cookies, which is
// harmless: visitors just get a fresh anon id).
function secret(): string {
  return process.env.AUTH_SECRET || 'dev-insecure-anon-secret'
}

function sign(id: string): string {
  return createHmac('sha256', secret()).update(id).digest('base64url')
}

export function newAnonId(): string {
  return randomUUID()
}

// Produce the cookie value: "<uuid>.<sig>".
export function signWid(id: string): string {
  return `${id}.${sign(id)}`
}

// Verify a cookie value and return the id, or null if missing/malformed/forged.
export function parseWid(value: string | null | undefined): string | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = sign(id)
  // Constant-time compare so a forged cookie can't be brute-forced byte by byte.
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return id
}

// Cookie attributes for Set-Cookie. httpOnly (no JS access), lax (sent on
// top-level navigations, not cross-site subrequests), secure in production.
export function widCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: WID_MAX_AGE_SECONDS,
  }
}

// ---------------------------------------------------------------------------
// Account session — the `sid` cookie (magic-link auth).
//
// Unlike `wid`, the session cookie carries no HMAC: its value is the opaque
// `sessions.id` primary key — a 256-bit random string looked up server-side, so
// forging it means guessing a row that doesn't exist. The magic-link token is the
// same shape (a random `auth_tokens.token`), consumed once at verify.
// ---------------------------------------------------------------------------

export const SID_COOKIE = 'sid'
// Rolling session lifetime. Refreshed lazily on use (see getSessionUser) so an
// active account stays signed in without a DB write on every request.
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90 // 90 days
export const SID_MAX_AGE_SECONDS = 60 * 60 * 24 * 90
// Only refresh a session's expiry once it's more than a day into its window, so
// an active account isn't a DB write on every request (a rolling, not per-hit,
// extension). Equivalently: refresh when less than TTL-1day of life remains.
export const SESSION_REFRESH_THRESHOLD_MS = SESSION_TTL_MS - 1000 * 60 * 60 * 24
// Magic-link tokens are short-lived and single-use.
export const AUTH_TOKEN_TTL_MS = 1000 * 60 * 15 // 15 minutes

// A 256-bit random id, hex-encoded. Used for both session ids and magic-link
// tokens — both are opaque, unguessable database keys the app supplies itself.
export function newSessionId(): string {
  return randomBytes(32).toString('hex')
}

export function newAuthToken(): string {
  return randomBytes(32).toString('hex')
}

// Cookie attributes for the session cookie. Same posture as `wid` (httpOnly,
// lax, secure in prod) but a 90-day max-age matching the rolling session.
export function sidCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SID_MAX_AGE_SECONDS,
  }
}

// Attributes to clear the session cookie on logout (maxAge 0 expires it).
export function clearSidCookieOptions() {
  return { ...sidCookieOptions(), maxAge: 0 }
}

// Who a request is: an authenticated user, an anonymous device, or both during
// the merge window. Signed-out visitors only ever have anonId; signing in adds
// userId (and the login handler merges the anon history into the user).
export type Actor = { userId: string | null; anonId: string | null }

export function hasActor(a: Actor): boolean {
  return !!a.userId || !!a.anonId
}
