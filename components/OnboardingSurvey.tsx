'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sendAction, type RecEvent } from '@/lib/recs/client'

// The post-auth onboarding survey (account-only). Three skippable steps that seed
// explicit preferences: interests → where/how-much/when → a few events you're into.
// Picks are submitted to /api/onboarding at the end (which writes interests +
// live affinity + a taste vector and stamps onboarded_at); picked events are sent
// live as interested signals. Skipping still submits (empty is fine) so
// onboarded_at is stamped and the survey never reappears.

type Cat = { slug: string; name: string; color: string }
const DAYS = [
  { n: 0, label: 'Sun' },
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
]

export function OnboardingSurvey({
  categories,
  neighborhoods,
  topEvents,
  city,
  basePath,
  next,
}: {
  categories: Cat[]
  neighborhoods: string[]
  topEvents: RecEvent[]
  city: string
  basePath: string
  // Where to land after finishing/skipping — the destination the landing CTA
  // promised (full list, weekend filter, or a category). Falls back to the city
  // home when a visitor reached onboarding without an intent.
  next?: string
}) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [hoods, setHoods] = useState<Set<string>>(new Set())
  const [freeOnly, setFreeOnly] = useState(false)
  const [days, setDays] = useState<Set<number>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    apply(next)
  }

  function saveEvent(id: string) {
    const isSaving = !saved.has(id)
    toggle(saved, id, setSaved)
    void sendAction(isSaving ? 'interested' : 'uninterested', { eventId: id, city, serveId: null })
  }

  async function finish() {
    setSubmitting(true)
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: [...cats],
          neighborhoods: [...hoods],
          freeOnly,
          days: [...days],
        }),
      })
    } catch {
      // Best-effort — even if this fails, don't trap the user in onboarding.
    }
    router.push(next || basePath)
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1.5">
          {[1, 2, 3].map(s => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all ${s === step ? 'w-8 bg-primary' : 'w-4 bg-muted'}`}
            />
          ))}
        </div>
        <button onClick={finish} className="text-sm text-muted-foreground hover:text-foreground" disabled={submitting}>
          Skip
        </button>
      </div>

      {step === 1 && (
        <section>
          <h1 className="font-display text-2xl font-semibold mb-1">What are you into?</h1>
          <p className="text-sm text-muted-foreground mb-5">Pick a few — this tunes your recommendations. (Suggest 3+.)</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(c => {
              const on = cats.has(c.slug)
              return (
                <button
                  key={c.slug}
                  onClick={() => toggle(cats, c.slug, setCats)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c.color }} />
                  {c.name}
                  {on && <Check className="w-3.5 h-3.5" />}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-semibold mb-1">Where & how much?</h1>
            <p className="text-sm text-muted-foreground mb-4">Optional — helps us favor the right neighborhoods and prices.</p>
            {neighborhoods.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {neighborhoods.map(n => {
                  const on = hoods.has(n)
                  return (
                    <button
                      key={n}
                      onClick={() => toggle(hoods, n, setHoods)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary'
                      }`}
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No neighborhood data yet — skip this.</p>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} className="h-4 w-4" />
            Mostly interested in free events
          </label>
          <div>
            <p className="text-sm font-medium mb-2">Typical nights out</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(d => {
                const on = days.has(d.n)
                return (
                  <button
                    key={d.n}
                    onClick={() => toggle(days, d.n, setDays)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1 className="font-display text-2xl font-semibold mb-1">Anything you already love?</h1>
          <p className="text-sm text-muted-foreground mb-5">Mark a few you’re interested in and we’ll learn from them right away.</p>
          {topEvents.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {topEvents.map(ev => {
                const on = saved.has(ev.id)
                const img = typeof ev.image_url === 'string' ? ev.image_url : null
                return (
                  <button
                    key={ev.id}
                    onClick={() => saveEvent(ev.id)}
                    className={`text-left rounded-xl border overflow-hidden transition-all ${
                      on ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary'
                    }`}
                  >
                    <div className="relative aspect-video bg-muted">
                      {img && <Image src={img} alt="" fill sizes="200px" className="object-cover" />}
                      {on && (
                        <span className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="w-4 h-4" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium p-2 line-clamp-2">{String(ev.title ?? '')}</p>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No events to show right now — you’re all set.</p>
          )}
        </section>
      )}

      <div className="flex items-center justify-between mt-8">
        <Button variant="ghost" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1 || submitting}>
          Back
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep(s => Math.min(3, s + 1))}>Next</Button>
        ) : (
          <Button onClick={finish} disabled={submitting}>
            {submitting ? 'Finishing…' : 'Finish'}
          </Button>
        )}
      </div>
    </div>
  )
}
