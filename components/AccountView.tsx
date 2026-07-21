'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Star, X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sendAction } from '@/lib/recs/client'
import { filterAndSortByDate, type DateFilter } from '@/lib/eventDates'
import type { SurveyPrefs } from '@/lib/recs/interests'
import { RewardsPanel } from '@/components/RewardsPanel'
import type { RewardsSummary } from '@/lib/rewards/data'

// The account/settings page (client). Server-rendered data comes in as props; each
// section edits through the /api/profile + /api/favorites endpoints. Kept to plain
// fetch calls and optimistic list removal — no form library — matching the rest of
// the app.

type Cat = { slug: string; name: string; color: string }
type EventLite = { id: string; title: string; start_time: string; venue_name: string | null }

const DAYS = [
  { n: 0, label: 'Sun' }, { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' },
]
const CITY = 'austin'
const BASE = '/austin'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function AccountView({
  email,
  displayName: initialName,
  personalizationOptOut: initialOptOut,
  magicLinkEnabled: initialMagicLink,
  prefs: initialPrefs,
  categories,
  neighborhoods,
  interested,
  hidden,
  digest,
  rewards,
  now,
}: {
  email: string
  displayName: string | null
  personalizationOptOut: boolean
  magicLinkEnabled: boolean
  prefs: SurveyPrefs
  categories: Cat[]
  neighborhoods: string[]
  interested: EventLite[]
  hidden: EventLite[]
  digest: { frequency: string; confirmed: boolean } | null
  rewards: RewardsSummary
  // Server-evaluated "now" (epoch ms) — the reference for past/future. Passed in
  // so the timestamp is stable and identical across the server and client render.
  now: number
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName ?? '')
  const [optOut, setOptOut] = useState(initialOptOut)
  const [magicLink, setMagicLink] = useState(initialMagicLink)
  const [cats, setCats] = useState<Set<string>>(new Set(initialPrefs.categories))
  const [hoods, setHoods] = useState<Set<string>>(new Set(initialPrefs.neighborhoods))
  const [freeOnly, setFreeOnly] = useState(initialPrefs.freeOnly)
  const [days, setDays] = useState<Set<number>>(new Set(initialPrefs.days))
  const [savedMsg, setSavedMsg] = useState('')

  const [ints, setInts] = useState(interested)
  const [hids, setHids] = useState(hidden)

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    apply(next)
  }

  async function saveProfile() {
    setSavedMsg('')
    await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: name.trim() || null,
        personalizationOptOut: optOut,
        magicLinkEnabled: magicLink,
        prefs: { categories: [...cats], neighborhoods: [...hoods], freeOnly, days: [...days] },
      }),
    })
    setSavedMsg('Saved.')
  }

  function removeInterested(id: string) {
    setInts(prev => prev.filter(e => e.id !== id))
    void sendAction('uninterested', { eventId: id, city: CITY, serveId: null })
  }
  async function unhide(id: string) {
    setHids(prev => prev.filter(e => e.id !== id))
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unhide', eventId: id }),
    })
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push(BASE)
    router.refresh()
  }
  async function clearHistory() {
    if (!confirm('Clear your viewing/interaction history? Your interests are kept.')) return
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clearHistory' }),
    })
    setSavedMsg('History cleared.')
  }
  async function deleteAccount() {
    if (!confirm('Permanently delete your account and all personalization data? This cannot be undone.')) return
    await fetch('/api/profile', { method: 'DELETE' })
    router.push(BASE)
    router.refresh()
  }

  return (
    <div className="space-y-10">
      {/* Profile */}
      <section>
        <h2 className="font-display text-lg font-semibold mb-3">Profile</h2>
        <p className="text-sm text-muted-foreground mb-3">Signed in as <strong>{email}</strong></p>
        <label className="block text-sm font-medium mb-1" htmlFor="name">Display name</label>
        <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Optional" className="max-w-sm" />
      </section>

      {/* Interests */}
      <section>
        <h2 className="font-display text-lg font-semibold mb-1">Interests</h2>
        <p className="text-sm text-muted-foreground mb-3">These directly tune your recommendations.</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {categories.map(c => {
            const on = cats.has(c.slug)
            return (
              <Chip key={c.slug} on={on} onClick={() => toggle(cats, c.slug, setCats)}>
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c.color }} /> {c.name}
              </Chip>
            )
          })}
        </div>
        {neighborhoods.length > 0 && (
          <>
            <p className="text-sm font-medium mb-2">Neighborhoods</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {neighborhoods.map(n => (
                <Chip key={n} on={hoods.has(n)} onClick={() => toggle(hoods, n, setHoods)}>{n}</Chip>
              ))}
            </div>
          </>
        )}
        <p className="text-sm font-medium mb-2">Typical nights out</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {DAYS.map(d => (
            <Chip key={d.n} on={days.has(d.n)} onClick={() => toggle(days, d.n, setDays)}>{d.label}</Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} className="h-4 w-4" />
          Mostly interested in free events
        </label>
      </section>

      {/* Rewards */}
      <RewardsPanel summary={rewards} />

      {/* Interested — id anchors the header avatar menu's "Interested events" link. */}
      <div id="interested" className="scroll-mt-24">
        <EventList title="Interested" icon={<Star className="w-4 h-4 text-amber-500" />} events={ints} now={now} empty="Nothing marked interesting yet."
          action={{ label: 'Remove', icon: <X className="w-4 h-4" />, run: removeInterested }} />
      </div>

      {/* Not interested */}
      <EventList title="Not interested" icon={<X className="w-4 h-4 text-muted-foreground" />} events={hids} now={now} empty="You haven't hidden anything."
        action={{ label: 'Restore', icon: <RotateCcw className="w-4 h-4" />, run: unhide }} />

      {/* Digest */}
      <section>
        <h2 className="font-display text-lg font-semibold mb-1">Email digest</h2>
        {digest ? (
          <p className="text-sm text-muted-foreground">
            You’re {digest.confirmed ? 'subscribed' : 'pending confirmation'} to the <strong>{digest.frequency}</strong> Austin digest.{' '}
            <Link href={`${BASE}/subscribe`} className="text-primary hover:underline">Manage</Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            You’re not subscribed. <Link href={`${BASE}/subscribe`} className="text-primary hover:underline">Get the weekly digest</Link>
          </p>
        )}
      </section>

      {/* Sign-in */}
      <section>
        <h2 className="font-display text-lg font-semibold mb-1">Sign-in</h2>
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={magicLink} onChange={e => setMagicLink(e.target.checked)} className="h-4 w-4 mt-0.5" />
          <span>
            Allow signing in with a magic link
            <span className="block text-muted-foreground">
              Adds a passwordless email link as a sign-in option for this account. Off by default; you always keep your password. Save changes to apply.
            </span>
          </span>
        </label>
      </section>

      {/* Save bar */}
      <section className="flex items-center gap-3">
        <Button onClick={saveProfile}>Save changes</Button>
        {savedMsg && <span className="text-sm text-muted-foreground">{savedMsg}</span>}
      </section>

      {/* Privacy */}
      <section className="border-t pt-6 space-y-4">
        <h2 className="font-display text-lg font-semibold">Privacy</h2>
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <input type="checkbox" checked={optOut} onChange={e => setOptOut(e.target.checked)} className="h-4 w-4 mt-0.5" />
          <span>
            Turn off personalization
            <span className="block text-muted-foreground">Stop using my activity to rank events. Save changes to apply.</span>
          </span>
        </label>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button variant="outline" onClick={signOut}>Sign out</Button>
          <Button variant="outline" onClick={clearHistory}>Clear history</Button>
          <Button variant="outline" onClick={deleteAccount} className="text-destructive border-destructive/40 hover:bg-destructive/10">
            Delete account
          </Button>
        </div>
      </section>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary'
      }`}
    >
      {children}
    </button>
  )
}

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
]

function EventList({
  title,
  icon,
  events,
  empty,
  action,
  now,
}: {
  title: string
  icon: React.ReactNode
  events: EventLite[]
  empty: string
  action: { label: string; icon: React.ReactNode; run: (id: string) => void }
  now: number
}) {
  // Default to upcoming: only show events that haven't passed.
  const [filter, setFilter] = useState<DateFilter>('upcoming')

  const shown = useMemo(() => filterAndSortByDate(events, now, filter), [events, filter, now])

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold flex items-center gap-2">{icon} {title}</h2>
        {events.length > 0 && (
          <div className="inline-flex rounded-lg border p-0.5 text-xs">
            {DATE_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filter === f.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === 'upcoming'
            ? 'No upcoming events — switch to Past or All to see earlier ones.'
            : filter === 'past'
              ? 'No past events yet.'
              : empty}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {shown.map(({ item: e, past }) => (
            <li key={e.id} className={`flex items-center gap-3 p-3 transition-opacity ${past ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <Link href={`${BASE}/events/${e.id}`} className="font-medium text-sm hover:text-primary line-clamp-1">
                  {e.title}
                </Link>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  {past && (
                    <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                      Past
                    </span>
                  )}
                  <span className="min-w-0 truncate">
                    {fmtDate(e.start_time)}{e.venue_name ? ` · ${e.venue_name}` : ''}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => action.run(e.id)}
                aria-label={action.label}
                title={action.label}
                className="shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {action.icon} {action.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
