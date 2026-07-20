'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { RewardToast } from './RewardToast'
import { getBadge } from '@/lib/rewards/catalog'

// Session-wide "you earned a badge" celebrations. Any client action that unlocks
// badges (check-in, saves) calls celebrate(ids); the provider queues a toast per
// badge. Optional: components use `useRewards()?.celebrate` so they stay usable
// even when no provider is mounted (e.g. logged-out pages).

type RewardsCtx = { celebrate: (badgeIds: string[]) => void }
const Ctx = createContext<RewardsCtx | null>(null)
export function useRewards(): RewardsCtx | null {
  return useContext(Ctx)
}

type QueuedToast = { key: number; badgeId: string }

export function RewardsProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<QueuedToast[]>([])
  const nextKey = useRef(0)

  const celebrate = useCallback((badgeIds: string[]) => {
    const fresh = badgeIds.filter(id => getBadge(id))
    if (fresh.length === 0) return
    setToasts(prev => [...prev, ...fresh.map(badgeId => ({ key: nextKey.current++, badgeId }))])
  }, [])

  const remove = useCallback((key: number) => {
    setToasts(prev => prev.filter(t => t.key !== key))
  }, [])

  return (
    <Ctx.Provider value={{ celebrate }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
          {toasts.map(t => {
            const badge = getBadge(t.badgeId)
            if (!badge) return null
            return <RewardToast key={t.key} badge={badge} onDone={() => remove(t.key)} />
          })}
        </div>
      )}
    </Ctx.Provider>
  )
}
