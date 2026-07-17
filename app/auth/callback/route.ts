import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sanitizeNext } from '@/lib/auth/nextParam'

// Supabase Auth PKCE callback: opt-in magic links and password-recovery links
// land here with a `code`. We exchange it for a session and route onward.
// Password sign-in/sign-up don't come through here — they establish the session
// directly in the browser.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  // Open-redirect-safe same-origin destination the CTA/sign-in asked for.
  const backPath = sanitizeNext(searchParams.get('next')) ?? ''

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      // Recovery links must always reach the set-new-password page, regardless of
      // onboarding state.
      if (backPath === '/reset-password') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }
      const { data: prof } = await supabase.from('profiles').select('onboarded_at').eq('id', data.user.id).maybeSingle()
      // First-timers go through onboarding, but carry the intended destination
      // so the survey (finish OR skip) lands them where the CTA promised — the
      // full events list, weekend filter, or a category — instead of always
      // dumping them on the city home.
      // If backPath is already an /onboarding URL (a logged-out visitor who hit
      // onboarding directly and bounced through sign-in), it carries its own
      // `next` — reuse it as-is rather than nesting onboarding inside onboarding.
      const onboardDest = !backPath
        ? '/onboarding'
        : backPath.startsWith('/onboarding')
          ? backPath
          : `/onboarding?next=${encodeURIComponent(backPath)}`
      const dest = prof?.onboarded_at ? backPath || '/austin' : onboardDest
      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=link`)
}
