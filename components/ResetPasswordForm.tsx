'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/browser'

const MIN_PASSWORD = 8

// Set a new password. Reached from the recovery link after /auth/callback has
// exchanged the code for a temporary session, so updateUser is authorized. If
// there's no session (e.g. the page was opened directly), we say so and point
// back to the request flow rather than showing a form that can't succeed.
export function ResetPasswordForm() {
  const [ready, setReady] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setReady(!!data.user))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setMessage(`Password must be at least ${MIN_PASSWORD} characters.`)
      setStatus('error')
      return
    }
    setStatus('loading')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage(error.message || 'Could not update your password. Request a new reset link.')
      setStatus('error')
      return
    }
    window.location.href = '/account'
  }

  if (ready === null) return null

  if (!ready) {
    return (
      <div className="text-center py-8 space-y-3">
        <p className="text-sm text-muted-foreground">
          This reset link is invalid or has expired.
        </p>
        <Link href="/forgot-password" className="inline-block text-sm text-primary hover:underline">
          Request a new reset link
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="password">New password</label>
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
        disabled={status === 'loading' || !password}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {status === 'loading' ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  )
}
