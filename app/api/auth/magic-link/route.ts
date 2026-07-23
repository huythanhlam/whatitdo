import { NextRequest, NextResponse } from 'next/server'
import { checkBotId } from 'botid/server'
import { createServiceClient } from '@/lib/supabase/service'

// Gated passwordless sign-in. Magic link is a per-account opt-in (default off),
// so the OTP is sent ONLY when the account behind this email enabled it. The
// check + send run server-side with the service role; the sign-in page can't do
// this itself because it doesn't yet know who the visitor is, and a client-side
// signInWithOtp would let anyone email-bomb any registered address.
//
// The response is ALWAYS a neutral { ok: true } — success and "not allowed" are
// indistinguishable, so this never reveals which emails exist or opted in.
const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function POST(req: NextRequest) {
  // Bots are the email-bomb threat here. Skip the send but return the SAME
  // neutral response so this stays indistinguishable from every other outcome
  // (never reveals bot-ness, account existence, or opt-in state).
  if ((await checkBotId()).isBot) {
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  let body: { email?: unknown; redirect?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const redirect = typeof body.redirect === 'string' ? body.redirect : ''
  const next = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : ''

  // Basic shape check; anything malformed just no-ops (still neutral).
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    try {
      const svc = createServiceClient()
      const { data: allowed, error } = await svc.rpc('magic_link_allowed', { p_email: email })
      if (!error && allowed === true) {
        const emailRedirectTo = `${req.nextUrl.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`
        // shouldCreateUser: false — magic link may sign in existing opted-in
        // accounts but must never create one (sign-up is password-only).
        const { error: otpError } = await svc.auth.signInWithOtp({
          email,
          options: { emailRedirectTo, shouldCreateUser: false },
        })
        if (otpError) console.error('magic-link OTP send failed:', otpError.message)
      }
    } catch (e) {
      console.error('magic-link route error:', e)
    }
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
