'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/browser'

// Google sign-in via Supabase Auth (OAuth). Unlike password / magic-link, this
// bounces the browser out to Google and back through Supabase, which finally
// lands on /auth/callback?code=… — the very same PKCE callback the magic-link
// flow already uses. That route exchanges the code for a session and routes
// first-timers into onboarding, so there's nothing Google-specific to handle
// server-side. This one button serves both sign-in and sign-up: OAuth creates
// the account on first use and signs the user in on every return.
//
// `redirect` is the same-origin path the caller wants the user to end up at once
// authenticated (the "join" gate / standalone pages pass the CTA's destination).
// It rides through the callback as `?next=`, which the callback sanitizes.
export function GoogleSignInButton({ redirect }: { redirect?: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  async function signIn() {
    setStatus('loading')
    const supabase = createClient()
    // The callback reads `next` to pick the post-auth destination. Supabase
    // appends `?code=…` to this URL after Google returns.
    const callback = new URL('/auth/callback', window.location.origin)
    if (redirect) callback.searchParams.set('next', redirect)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    })
    if (error) {
      setStatus('error')
      return
    }
    // On success the browser is already navigating to Google — leave it loading.
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={signIn}
        disabled={status === 'loading'}
        className="w-full"
      >
        <GoogleIcon />
        {status === 'loading' ? 'Redirecting…' : 'Continue with Google'}
      </Button>
      {status === 'error' && (
        <p className="text-sm text-destructive text-center">
          Couldn’t start Google sign-in. Please try again.
        </p>
      )}
    </div>
  )
}

// The official Google "G" mark. lucide-react doesn't ship brand logos, so the
// four-colour SVG is inlined here.
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}
