'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { createClient } from '@/lib/supabase/browser'

// Passwordless sign-in via Supabase Auth (email magic link / OTP). The "email me
// the digest" opt-in rides along in user metadata and is applied in the callback.
// No password; the link returns to /auth/callback which opens the session.
//
// The post-auth destination comes from `redirectTo` when provided (the "join"
// gate passes the CTA's intended landing spot) and otherwise falls back to the
// `?redirect=` search param (the standalone /signin page). It is threaded to
// /auth/callback as `next`, which the callback carries through onboarding.
export function SignInForm({ redirectTo }: { redirectTo?: string }) {
  const params = useSearchParams()
  const redirect = redirectTo ?? params.get('redirect') ?? ''
  const linkError = params.get('error') === 'link'

  const [email, setEmail] = useState('')
  const [wantsDigest, setWantsDigest] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const supabase = createClient()
    const emailRedirectTo = `${window.location.origin}/auth/callback${redirect ? `?next=${encodeURIComponent(redirect)}` : ''}`
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo, data: { wants_digest: wantsDigest }, shouldCreateUser: true },
    })
    if (error) {
      setMessage(error.message || 'Something went wrong. Please try again.')
      setStatus('error')
      return
    }
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <div className="text-center py-8 space-y-3">
        <p className="text-5xl">📬</p>
        <h2 className="text-xl font-bold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          We emailed a sign-in link to <strong>{email}</strong>. Click it to finish signing in.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {linkError && (
        <p className="text-sm text-destructive">
          That sign-in link was invalid or expired. Enter your email to get a new one.
        </p>
      )}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="email">
          Email
        </label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <label className="flex items-start gap-2 cursor-pointer text-sm">
        <Checkbox checked={wantsDigest} onCheckedChange={v => setWantsDigest(v === true)} className="mt-0.5" />
        <span>Also email me the weekly Austin events digest.</span>
      </label>
      {status === 'error' && <p className="text-sm text-destructive">{message}</p>}
      <Button
        type="submit"
        disabled={status === 'loading' || !email.trim()}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {status === 'loading' ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        No password needed — we’ll email you a one-time magic link.
      </p>
    </form>
  )
}
