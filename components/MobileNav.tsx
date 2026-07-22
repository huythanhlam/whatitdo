'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Menu, X, Send, Bell, Star, Settings, LogOut, LogIn, UserPlus } from 'lucide-react'

type Me = { signedIn: boolean; displayName: string | null }

// Mobile-only header menu. On phones the logo + wordmark + a Get Updates pill +
// the auth avatar don't all fit on one row, so the action cluster wrapped to a
// second line. This collapses those actions (Submit, Get Updates, and the same
// auth items AuthNav shows) behind a hamburger, keeping the header to two clean
// rows: [logo · menu] then [search]. Hidden at sm+ where the full cluster fits.
//
// `showAuth` mirrors the header's `isRecsCity` gate (auth is Austin-only at
// launch); when false the menu is just Submit + Get Updates and no /api/auth/me
// fetch happens.
export function MobileNav({ base, showAuth }: { base: string; showAuth: boolean }) {
  const [me, setMe] = useState<Me | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showAuth) return
    let alive = true
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive && d) setMe({ signedIn: !!d.signedIn, displayName: d.displayName ?? null })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [showAuth])

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

  async function signOut() {
    setOpen(false)
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        onClick={() => setOpen(o => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground border border-border transition-colors hover:border-primary hover:text-primary"
      >
        {open ? <X className="w-4 h-4" aria-hidden /> : <Menu className="w-4 h-4" aria-hidden />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu"
          className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg p-1 z-50"
        >
          <MenuLink href={`${base}/submit`} icon={<Send className="w-4 h-4" />} onSelect={() => setOpen(false)}>
            Submit an event
          </MenuLink>
          <MenuLink href={`${base}/subscribe`} icon={<Bell className="w-4 h-4" />} onSelect={() => setOpen(false)}>
            Get Updates
          </MenuLink>

          {showAuth && me !== null && (
            <>
              <div className="my-1 h-px bg-border" />
              {me.signedIn ? (
                <>
                  <p className="px-3 pt-1 pb-1 text-xs text-muted-foreground">
                    Signed in{me.displayName ? <> as <span className="font-medium text-foreground">{me.displayName}</span></> : null}
                  </p>
                  <MenuLink href="/account#interested" icon={<Star className="w-4 h-4" />} onSelect={() => setOpen(false)}>
                    Interested events
                  </MenuLink>
                  <MenuLink href="/account" icon={<Settings className="w-4 h-4" />} onSelect={() => setOpen(false)}>
                    Account settings
                  </MenuLink>
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
