'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { createClient } from '@/lib/supabase/browser'
import { trackEvent } from '@/lib/analytics'

const MIN_PASSWORD = 8

// Password sign-up via Supabase Auth. With email confirmations disabled (see
// supabase/config.toml) signUp sends no email and returns a session immediately,
// so we go straight to onboarding. Display name is optional and best-effort
// written to the profile row (created by the on-signup trigger).
//
// `redirectTo` (from the "join" registration gate) is the destination the CTA
// promised. It rides through onboarding as `?next=` so finishing/skipping the
// survey lands the new account there instead of the city home; falls back to
// the `?redirect=` search param for the standalone /signup page.
export function SignUpForm({ redirectTo }: { redirectTo?: string }) {
  const params = useSearchParams()
  const redirect = redirectTo ?? params.get('redirect') ?? ''
  const signinHref = `/signin${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`

  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setMessage(`Password must be at least ${MIN_PASSWORD} characters.`)
      setStatus('error')
      return
    }
    setStatus('loading')
    const supabase = createClient()
    const name = displayName.trim()
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: name ? { display_name: name } : undefined },
    })
    if (error) {
      setMessage(error.message || 'Could not create your account. Please try again.')
      setStatus('error')
      return
    }
    // Persist the display name to the profile row (best-effort; RLS allows own row).
    if (name && data.user) {
      await supabase.from('profiles').update({ display_name: name }).eq('id', data.user.id)
    }
    // Account creation conversion. Fired before the full-page nav below so the
    // beacon is queued while this document is still alive.
    trackEvent('sign_up', { method: 'password' })
    // Full navigation so the server sees the freshly set session cookie. Carry
    // the CTA destination through onboarding so finish/skip lands there.
    window.location.href = redirect ? `/onboarding?next=${encodeURIComponent(redirect)}` : '/onboarding'
  }

  return (
    <div className="space-y-4">
      <GoogleSignInButton redirect={redirect} />
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="display-name">
          Display name <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="display-name"
          type="text"
          autoComplete="nickname"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="What should we call you?"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="password">Password</label>
        <Input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={`At least ${MIN_PASSWORD} characters`}
        />
      </div>
      {status === 'error' && <p className="text-sm text-destructive">{message}</p>}
      <Button
        type="submit"
        disabled={status === 'loading' || !email.trim() || !password}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {status === 'loading' ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-sm text-muted-foreground text-center">
        Already have an account?{' '}
        <Link href={signinHref} className="text-primary hover:underline font-medium">Sign in</Link>
      </p>
      </form>
    </div>
  )
}
