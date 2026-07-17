import type { NextRequest, NextResponse } from 'next/server'
import {
  WID_COOKIE,
  SID_COOKIE,
  parseWid,
  newAnonId,
  signWid,
  widCookieOptions,
  type Actor,
} from './session'
import { getSessionUser } from '@/lib/db'

// Bridge between the framework (NextRequest/NextResponse) and the pure cookie
// helpers in session.ts. Kept out of session.ts so that module stays free of
// next/server and unit-testable on its own.

// Read the anonymous device id from the signed cookie, minting a fresh one if
// it's absent or forged. `isNew` tells the caller to set the cookie on the way
// out (via attachAnon).
export function resolveAnon(req: NextRequest): { anonId: string; isNew: boolean } {
  const existing = parseWid(req.cookies.get(WID_COOKIE)?.value)
  return existing ? { anonId: existing, isNew: false } : { anonId: newAnonId(), isNew: true }
}

// Set the signed `wid` cookie on the response — only when it was freshly minted,
// so we don't rewrite Set-Cookie on every request.
export function attachAnon(res: NextResponse, anonId: string, isNew: boolean): void {
  if (isNew) res.cookies.set(WID_COOKIE, signWid(anonId), widCookieOptions())
}

// The full actor for a request: an authenticated `userId` when a valid `sid`
// session cookie is present, plus the anonymous device id (always resolved, so
// signed-out visitors still personalize and so the login handler can merge the
// device's history into the account). `anonIsNew` tells the caller to set the
// `wid` cookie on the way out via attachAnon.
//
// Async because the session cookie is opaque — it must be looked up in the DB to
// find the user it belongs to (and to honor expiry / rolling refresh).
export async function resolveActor(req: NextRequest): Promise<{ actor: Actor; anonIsNew: boolean }> {
  const { anonId, isNew } = resolveAnon(req)
  const sid = req.cookies.get(SID_COOKIE)?.value
  const userId = sid ? await getSessionUser(sid) : null
  return { actor: { userId, anonId }, anonIsNew: isNew }
}

// Just the authenticated user id for a request, or null — for account-only route
// handlers (profile, onboarding) that don't need the anonymous device id and
// shouldn't mint a `wid` cookie as a side effect.
export async function requireSessionUser(req: NextRequest): Promise<string | null> {
  const sid = req.cookies.get(SID_COOKIE)?.value
  return sid ? getSessionUser(sid) : null
}
