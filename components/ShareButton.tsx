'use client'

import { useEffect, useRef, useState } from 'react'
import { Share2, Copy, Check, Mail, MessageCircle, MessageSquare, AtSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { track } from '@/lib/track'
import { buildShareTargets, shareText, type ShareTarget } from '@/lib/share'

// The share affordance on an event detail page. A "Share" button opens a small
// popover of destinations. On devices that expose navigator.share (mostly
// mobile) a "More apps…" item opens the native sheet — the only path that can
// reach Instagram, TikTok, and Messenger, which have no web share-link scheme.
// Explicit web buttons cover WhatsApp / X / Facebook / Email, plus a copy-link
// action. Every path fires a best-effort 'share' signal for personalization.
export function ShareButton({
  url,
  title,
  city,
  eventId,
}: {
  url: string
  title: string
  city: string
  eventId: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // navigator.share exists mostly on mobile. Computing this during render is safe
  // for hydration: it gates the "More apps…" item, which only renders once the
  // menu is open — a user interaction that happens well after the first paint.
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  // Close on outside-click or Escape while the menu is open.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const targets = buildShareTargets({ url, title })

  const logShare = () => track('share', { eventId, city })

  const openTarget = (t: ShareTarget) => {
    logShare()
    // http(s) intents (WhatsApp, X) open in a new tab; app/OS schemes (sms: for
    // iMessage, fb-messenger:, mailto:) are handed to the OS handler via a
    // same-window assignment so they don't leave a stranded blank tab behind.
    if (t.href.startsWith('http')) {
      window.open(t.href, '_blank', 'noopener,noreferrer')
    } else {
      window.location.assign(t.href)
    }
    setOpen(false)
  }

  const nativeShare = async () => {
    logShare()
    setOpen(false)
    try {
      await navigator.share({ title, text: shareText(title), url })
    } catch {
      // User dismissed the sheet, or it's unavailable — nothing to recover.
    }
  }

  const copyLink = async () => {
    logShare()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure context / permissions) — leave the menu open
      // so the user can still pick another destination.
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Share2 className="w-4 h-4" /> Share
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Share this event"
          className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-md border bg-popover p-1 shadow-md"
        >
          {canNativeShare && (
            <MenuItem onClick={nativeShare}>
              <Share2 className="w-4 h-4" /> More apps…
            </MenuItem>
          )}
          {targets.map(t => (
            <MenuItem key={t.id} onClick={() => openTarget(t)}>
              <TargetIcon id={t.id} /> {t.label}
            </MenuItem>
          ))}
          <MenuItem onClick={copyLink}>
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy link'}
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function TargetIcon({ id }: { id: ShareTarget['id'] }) {
  const cls = 'w-4 h-4'
  switch (id) {
    case 'whatsapp':
      return <MessageCircle className={cls} />
    case 'imessage':
      return <MessageSquare className={cls} />
    case 'x':
      return <AtSign className={cls} />
    case 'email':
      return <Mail className={cls} />
  }
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
