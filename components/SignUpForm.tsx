'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/browser'

const MIN_PASSWORD = 8

// Password sign-up via Supabase Auth. With email confirmations disabled (see
// supabase/config.toml) signUp sends no email and returns a session immediately,
// so we go straight to onboarding. Display name is optional and best-effort
// written to the profile row (created by the on-signup trigger).
export function SignUpForm() {
  const params = useSearchParams()
  const redirect = params.get('redirect') ?? ''
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
    // Full navigation so the server sees the freshly set session cookie.
    window.location.href = '/onboarding'
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
  )
}
