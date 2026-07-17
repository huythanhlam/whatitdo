'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/browser'

// Request a password-reset email. Supabase sends a recovery link that lands on
// /auth/callback (which exchanges it for a temporary session) and forwards to
// /reset-password to set a new password. Email is sent on-demand only.
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const supabase = createClient()
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`
    // Ignore the result on purpose — the confirmation is neutral either way so
    // it doesn't reveal whether the address has an account.
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <div className="text-center py-8 space-y-3">
        <p className="text-5xl">📬</p>
        <h2 className="text-xl font-bold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          If an account exists for <strong>{email}</strong>, we emailed a link to reset your password.
        </p>
        <Link href="/signin" className="inline-block text-sm text-primary hover:underline">
          ← Back to sign in
        </Link>
      </div>
    )
  }

  return (
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
      <Button
        type="submit"
        disabled={status === 'loading' || !email.trim()}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {status === 'loading' ? 'Sending…' : 'Email me a reset link'}
      </Button>
      <Link href="/signin" className="block text-center text-sm text-primary hover:underline">
        ← Back to sign in
      </Link>
    </form>
  )
}
