import { NextRequest, NextResponse } from 'next/server'
import {
  consumeAuthToken,
  getOrCreateUser,
  createSession,
  mergeAnonIntoUser,
  linkSubscriptionsToUser,
  addSubscription,
  confirmSubscription,
  getCityBySlug,
} from '@/lib/db'
import { resolveAnon } from '@/lib/auth/actor'
import { SID_COOKIE, sidCookieOptions } from '@/lib/auth/session'
import { getBaseUrl } from '@/lib/site'

// Step 2 of magic-link sign-in: the link in the email lands here. Consume the
// token (single-use), get-or-create the account, open a session, and do the
// once-per-account convergence: merge the anonymous device's history onto the
// user, and link/confirm any digest subscriptions for the now-verified email
// (creating one if the registration checkbox was ticked). First-time accounts go
// on to onboarding; returning ones to the requested page or the city home.
//
// GET (not POST) so the plain link works from an email client; consuming a
// single-use token is the state change, and link-scanners hitting it just spend a
// token the user then can't reuse — acceptable, and far simpler than a landing
// page that re-POSTs.

export async function GET(req: NextRequest) {
  const base = getBaseUrl()
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const redirectParam = req.nextUrl.searchParams.get('redirect') ?? ''
  const backPath =
    redirectParam.startsWith('/') && !redirectParam.startsWith('//') ? redirectParam : ''

  const consumed = token ? await consumeAuthToken(token) : null
  if (!consumed) {
    // Unknown, expired, or already-used link → back to sign-in with a flag.
    return NextResponse.redirect(new URL('/signin?error=link', base))
  }

  const user = await getOrCreateUser(consumed.email)
  const isFirstLogin = user.onboarded_at === null

  // Merge the anonymous device history into the account (idempotent on re-login).
  const { anonId } = resolveAnon(req)
  if (anonId) {
    try {
      await mergeAnonIntoUser(user.id, anonId)
    } catch (e) {
      console.error('anon→user merge failed:', e)
    }
  }

  // Digest opt-in from the registration checkbox: the magic link proves the
  // email, so a subscription created here is confirmed outright (double opt-in
  // satisfied). Austin-only at launch, weekly, all categories by default.
  if (consumed.wantsDigest) {
    try {
      const city = await getCityBySlug('austin')
      if (city) {
        const subToken = await addSubscription({
          email: consumed.email,
          frequency: 'weekly',
          category_slugs: [],
          cityId: city.id,
        })
        if (subToken) await confirmSubscription(subToken)
      }
    } catch (e) {
      console.error('digest subscription failed:', e)
    }
  }

  // Link (and confirm) every subscription for this verified email to the account
  // — both the one just created and any the person had started earlier.
  try {
    await linkSubscriptionsToUser(user.id, consumed.email)
  } catch (e) {
    console.error('subscription link failed:', e)
  }

  const sid = await createSession(user.id)
  const dest = isFirstLogin ? '/onboarding' : backPath || '/austin'
  const res = NextResponse.redirect(new URL(dest, base))
  res.cookies.set(SID_COOKIE, sid, sidCookieOptions())
  return res
}
