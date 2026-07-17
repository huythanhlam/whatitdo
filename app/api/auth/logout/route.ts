import { NextRequest, NextResponse } from 'next/server'
import { deleteSession } from '@/lib/db'
import { SID_COOKIE, clearSidCookieOptions } from '@/lib/auth/session'

// End the session: drop the DB row and clear the cookie. POST (not GET) so a
// link-scanner or prefetch can't sign someone out.
export async function POST(req: NextRequest) {
  const sid = req.cookies.get(SID_COOKIE)?.value
  if (sid) {
    try {
      await deleteSession(sid)
    } catch (e) {
      console.error('logout failed:', e)
    }
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  res.cookies.set(SID_COOKIE, '', clearSidCookieOptions())
  return res
}
