'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { User } from 'lucide-react'

// Auth-aware nav link for the city header. The city page is ISR-cached, so it
// can't render per-visitor auth state server-side; this island fetches
// /api/auth/me on mount and shows "Account" (signed in) or "Sign in". Renders
// nothing until it knows, to avoid flashing the wrong state into the cached page.
export function AuthNav() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive && d) setSignedIn(!!d.signedIn)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (signedIn === null) return null

  return (
    <Link
      href={signedIn ? '/account' : '/signin'}
      className="order-3 sm:order-6 inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary"
    >
      <User className="w-4 h-4" />
      <span className="hidden sm:inline">{signedIn ? 'Account' : 'Sign in'}</span>
    </Link>
  )
}
