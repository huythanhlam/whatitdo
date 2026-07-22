'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { User, Star, Settings, LogOut, LogIn, UserPlus, Shield } from 'lucide-react'

type Me = { signedIn: boolean; displayName: string | null; isAdmin: boolean }

// Auth-aware avatar menu for the city header. The city page is ISR-cached, so it
// can't render per-visitor auth state server-side; this island fetches
// /api/auth/me on mount and renders a round bubble — the profile initial when
// signed in, a person icon otherwise. Hover/click/focus opens a menu that shows
// Sign in vs Sign out (per auth state) plus quick links into the profile.
// Renders nothing until it knows, to avoid flashing the wrong state.
export function AuthNav({ city }: { city: string }) {
  const [me, setMe] = useState<Me | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive && d) setMe({ signedIn: !!d.signedIn, displayName: d.displayName ?? null, isAdmin: !!d.isAdmin })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Close on outside click and on Escape while open.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (me === null) return null

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  async function signOut() {
    setOpen(false)
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  const initial = me.signedIn ? me.displayName?.trim().charAt(0).toUpperCase() : ''
  const label = me.signedIn ? 'Account menu' : 'Sign in menu'

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={e => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) closeSoon()
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
        className={
          me.signedIn
            ? 'flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-sm transition-transform hover:scale-105'
            : 'flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground border border-border transition-colors hover:border-primary hover:text-primary'
        }
      >
        {initial ? initial : <User className="w-4 h-4" aria-hidden />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg p-1 z-50"
        >
          {me.signedIn ? (
            <>
              <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                Signed in{me.displayName ? <> as <span className="font-medium text-foreground">{me.displayName}</span></> : null}
              </p>
              <MenuLink href="/account#interested" icon={<Star className="w-4 h-4" />} onSelect={() => setOpen(false)}>
                Interested events
              </MenuLink>
              <MenuLink href="/account" icon={<Settings className="w-4 h-4" />} onSelect={() => setOpen(false)}>
                Account settings
              </MenuLink>
              {me.isAdmin && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <MenuLink href={`/${city}/admin`} icon={<Shield className="w-4 h-4" />} onSelect={() => setOpen(false)}>
                    Admin
                  </MenuLink>
                </>
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-left hover:bg-secondary hover:text-primary"
              >
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </>
          ) : (
            <>
              <MenuLink href="/signin" icon={<LogIn className="w-4 h-4" />} onSelect={() => setOpen(false)}>
                Sign in
              </MenuLink>
              <MenuLink href="/signup" icon={<UserPlus className="w-4 h-4" />} onSelect={() => setOpen(false)}>
                Create account
              </MenuLink>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuLink({
  href,
  icon,
  children,
  onSelect,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
  onSelect: () => void
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-secondary hover:text-primary"
    >
      {icon} {children}
    </Link>
  )
}
