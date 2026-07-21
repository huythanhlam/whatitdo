import { MedalFrame } from './MedalFrame'
import type { BadgeDef, MedalTier } from '@/lib/rewards/catalog'

// A badge with its unlock condition always visible — no hover needed. Used on the
// /rewards catalog page, where there's room for a medal (left) plus the name,
// how-to-unlock text, tier, and points (right). Earned badges get a marker;
// locked ones stay muted but their unlock text remains fully readable.

const TIER_LABEL: Record<MedalTier, string> = {
  slate: 'Slate',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
}

export function BadgeDetailCard({ badge, earned }: { badge: BadgeDef; earned: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <MedalFrame tier={badge.tier} art={badge.art} earned={earned} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold leading-tight">{badge.name}</h4>
          {earned && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Earned</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">How to unlock: </span>
          {badge.description}
        </p>
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
          {TIER_LABEL[badge.tier]} · {badge.points} pts
        </p>
      </div>
    </div>
  )
}
