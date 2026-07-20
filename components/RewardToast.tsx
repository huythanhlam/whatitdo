'use client'

import { useEffect, useState } from 'react'
import { RewardMedal } from './RewardMedal'
import type { BadgeDef } from '@/lib/rewards/catalog'

// A single self-dismissing celebration card for a newly earned badge. Slides in,
// stays a few seconds, then fades. Dependency-free (no toast library in the repo).
export function RewardToast({ badge, onDone }: { badge: BadgeDef; onDone: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const inT = setTimeout(() => setVisible(true), 10)
    const outT = setTimeout(() => setVisible(false), 4200)
    const doneT = setTimeout(onDone, 4600)
    return () => {
      clearTimeout(inT)
      clearTimeout(outT)
      clearTimeout(doneT)
    }
  }, [onDone])

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-3 rounded-xl border bg-card/95 p-3 pr-4 shadow-lg backdrop-blur transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <RewardMedal badge={badge} earned size="md" />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Badge earned</p>
        <p className="text-sm font-semibold leading-tight">{badge.name}</p>
        <p className="text-xs text-muted-foreground leading-tight">{badge.description}</p>
      </div>
    </div>
  )
}
