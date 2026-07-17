import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sanitizeNext } from '@/lib/auth/nextParam'

// Supabase Auth callback (PKCE): the magic link / OTP lands here with a `code`.
// We exchange it for a session, honor the digest opt-in captured at sign-in, and
// send first-time users to onboarding. Replaces the home-grown /api/auth/verify.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  // Open-redirect-safe same-origin destination the CTA/sign-in asked for.
  const backPath = sanitizeNext(searchParams.get('next')) ?? ''

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      // Digest opt-in from the sign-in checkbox (stored in user metadata). Create
      // a confirmed subscription via the service client — the magic link proved
      // the email, satisfying double opt-in.
      if (data.user.user_metadata?.wants_digest === true && data.user.email) {
        try {
          const svc = createServiceClient()
          await svc.from('subscriptions').upsert(
            { email: data.user.email, user_id: data.user.id, frequency: 'weekly', category_slugs: [], city_id: 1, confirmed: true },
            { onConflict: 'email,city_id' }
          )
        } catch (e) {
          console.error('digest subscription failed:', e)
        }
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
