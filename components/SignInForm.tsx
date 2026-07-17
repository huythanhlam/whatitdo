'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'

// Magic-link sign-in: enter an email (optionally opt into the weekly digest) and
// we POST /api/auth/request, which emails a one-time link. No password. The
// response is neutral whether or not the address has an account, so this form
// always just says "check your inbox." In local dev with no Resend key the API
// returns the link inline (devLink) so sign-in is testable without email.
export function SignInForm() {
  const params = useSearchParams()
  const redirect = params.get('redirect') ?? ''
  const linkError = params.get('error') === 'link'

  const [email, setEmail] = useState('')
  const [wantsDigest, setWantsDigest] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [devLink, setDevLink] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), wantsDigest, redirect }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error ?? 'Something went wrong. Please try again.')
        setStatus('error')
        return
      }
      setDevLink(typeof data.devLink === 'string' ? data.devLink : null)
      setStatus('sent')
    } catch {
      setMessage('Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="text-center py-8 space-y-3">
        <p className="text-5xl">📬</p>
        <h2 className="text-xl font-bold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          We emailed a sign-in link to <strong>{email}</strong>. It works once and expires in 15 minutes.
        </p>
        {devLink && (
          <p className="text-xs break-all rounded-md bg-muted p-3">
            Dev mode (no email configured):{' '}
            <a className="text-primary underline" href={devLink}>
              open your sign-in link
            </a>
          </p>
        )}
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
