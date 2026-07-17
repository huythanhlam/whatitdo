import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase Auth PKCE callback: opt-in magic links and password-recovery links
// land here with a `code`. We exchange it for a session and route onward.
// Password sign-in/sign-up don't come through here — they establish the session
// directly in the browser.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const backPath = next && next.startsWith('/') && !next.startsWith('//') ? next : ''

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
      const dest = prof?.onboarded_at ? backPath || '/austin' : '/onboarding'
      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=link`)
}
