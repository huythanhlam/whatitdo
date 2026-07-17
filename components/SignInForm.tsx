'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/browser'

// Password-first sign-in via Supabase Auth. Email + password is the default (no
// email sent). Passwordless magic-link is a secondary, per-account opt-in: the
// "email me a link" path posts to /api/auth/magic-link, which only sends an OTP
// if that account enabled it — so email sends stay rare and deliberate.
export function SignInForm() {
  const params = useSearchParams()
  const redirect = params.get('redirect') ?? ''
  const linkError = params.get('error') === 'link'
  const signupHref = `/signup${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')

  // Passwordless side-panel state (opt-in only).
  const [showMagic, setShowMagic] = useState(false)
  const [magicStatus, setMagicStatus] = useState<'idle' | 'loading' | 'sent'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setMessage('That email or password is incorrect.')
      setStatus('error')
      return
    }
    // Full navigation so the server sees the freshly set session cookie.
    window.location.href = redirect || '/austin'
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setMagicStatus('loading')
    // Always resolves to the same neutral state — the server decides whether an
    // email actually goes out, and never reveals whether the account opted in.
    try {
      await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), redirect }),
      })
    } catch {
      // Swallow — neutral response regardless.
    }
    setMagicStatus('sent')
  }

  if (magicStatus === 'sent') {
    return (
      <div className="text-center py-8 space-y-3">
        <p className="text-5xl">📬</p>
        <h2 className="text-xl font-bold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          If magic-link sign-in is enabled for <strong>{email}</strong>, we just emailed a
          sign-in link. Otherwise, sign in with your password.
        </p>
        <button
          type="button"
          onClick={() => { setShowMagic(false); setMagicStatus('idle') }}
          className="text-sm text-primary hover:underline"
        >
          ← Back to password sign-in
        </button>
      </div>
    )
  }

  if (showMagic) {
    return (
      <form onSubmit={sendMagicLink} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Magic-link sign-in is available only for accounts that turned it on in settings.
        </p>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="magic-email">Email</label>
          <Input
            id="magic-email"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <Button
          type="submit"
          disabled={magicStatus === 'loading' || !email.trim()}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {magicStatus === 'loading' ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
        <button
          type="button"
          onClick={() => setShowMagic(false)}
          className="block w-full text-center text-sm text-primary hover:underline"
        >
          ← Sign in with a password instead
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {linkError && (
        <p className="text-sm text-destructive">
          That sign-in link was invalid or expired. Sign in with your password below.
        </p>
      )}
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
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium" htmlFor="password">Password</label>
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
        </div>
        <Input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Your password"
        />
      </div>
      {status === 'error' && <p className="text-sm text-destructive">{message}</p>}
      <Button
        type="submit"
        disabled={status === 'loading' || !email.trim() || !password}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {status === 'loading' ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-sm text-muted-foreground text-center">
        New here?{' '}
        <Link href={signupHref} className="text-primary hover:underline font-medium">Create an account</Link>
      </p>
      <button
        type="button"
        onClick={() => setShowMagic(true)}
        className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
      >
        Email me a sign-in link instead
      </button>
    </form>
  )
}
