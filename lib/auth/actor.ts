import type { NextRequest, NextResponse } from 'next/server'
import {
  WID_COOKIE,
  parseWid,
  newAnonId,
  signWid,
  widCookieOptions,
} from './session'

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
