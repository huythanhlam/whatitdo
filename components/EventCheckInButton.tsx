'use client'

import { useState } from 'react'
import { Check, MapPin } from 'lucide-react'
import { useInteractions } from './InteractionProvider'
import { useRewards } from './RewardsProvider'
import { checkIn } from '@/lib/rewards/client'

// "I was there" check-in for an event card/detail. The one submit surface for
// attendance. Only renders for signed-in users (via InteractionProvider) once the
// event has started — the low-friction, lightly abuse-resistant time gate.
// `started` is computed server-side by the caller (EventCard) so there's no
// SSR/CSR time mismatch; the server also re-validates the gate and idempotency.
export function EventCheckInButton({ eventId, started }: { eventId: string; started: boolean }) {
  const ctx = useInteractions()
  const rewards = useRewards()
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [error, setError] = useState('')

  if (!ctx || !ctx.authed || !started) return null

  async function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (state !== 'idle') return
    setState('loading')
    setError('')
    const res = await checkIn({ eventId, city: ctx!.city })
    if (res.ok) {
      setState('done')
      if (res.newlyEarned.length) rewards?.celebrate(res.newlyEarned)
    } else {
      setState('idle')
      setError(res.error)
    }
  }

  if (state === 'done') {
    return (
      <span className="mx-4 mb-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs font-semibold text-success">
        <Check className="h-4 w-4" /> Attended
      </span>
    )
  }

  return (
    <div className="mx-4 mb-4">
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'loading'}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
      >
        <MapPin className="h-4 w-4" /> {state === 'loading' ? 'Checking in…' : 'I was there'}
      </button>
      {error && <p className="mt-1 text-[11px] text-muted-foreground">{error}</p>}
    </div>
  )
}
