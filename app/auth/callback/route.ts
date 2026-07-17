import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Supabase Auth callback (PKCE): the magic link / OTP lands here with a `code`.
// We exchange it for a session, honor the digest opt-in captured at sign-in, and
// send first-time users to onboarding. Replaces the home-grown /api/auth/verify.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const backPath = next && next.startsWith('/') && !next.startsWith('//') ? next : ''

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
      const dest = prof?.onboarded_at ? backPath || '/austin' : '/onboarding'
      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=link`)
}
