import { cookies } from 'next/headers'
import { SID_COOKIE } from './session'
import { getSessionUser, getUserById, type User } from '@/lib/db'

// Server-Component auth: resolve the `sid` cookie to the signed-in user (or
// null) for RSC pages that gate on a session (onboarding, account) and for the
// auth-aware nav. Separate from lib/auth/actor.ts because it reads cookies via
// next/headers (RSC context) rather than a NextRequest (route-handler context);
// using it opts the page into dynamic rendering, which these pages already are.
export async function currentUser(): Promise<User | null> {
  const sid = (await cookies()).get(SID_COOKIE)?.value
  if (!sid) return null
  const userId = await getSessionUser(sid)
  if (!userId) return null
  return getUserById(userId)
}
