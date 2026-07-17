import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

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

// Who a request is: an authenticated user, an anonymous device, or both during
// the merge window. Phase 1 only ever populates anonId (accounts ship later).
export type Actor = { userId: string | null; anonId: string | null }

export function hasActor(a: Actor): boolean {
  return !!a.userId || !!a.anonId
}
