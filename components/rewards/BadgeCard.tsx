import { MedalFrame } from './MedalFrame'
import { Tooltip } from './Tooltip'
import type { BadgeDef, MedalTier } from '@/lib/rewards/catalog'

// One badge in the catalog: its medal (earned = full color, locked = muted) with
// a hover/focus tooltip that spells out how to unlock it. The MedalFrame is
// rendered without a `title` so there's no second, native tooltip on top.

const TIER_LABEL: Record<MedalTier, string> = {
  slate: 'Slate',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
}

export function BadgeCard({ badge, earned }: { badge: BadgeDef; earned: boolean }) {
  return (
    <Tooltip
      content={
        <div className="space-y-1 text-left">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">{badge.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{TIER_LABEL[badge.tier]}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">How to unlock: </span>
            {badge.description}
          </p>
          <p className="text-xs text-muted-foreground">
            {badge.points} pts
            {earned && <span className="ml-1 font-medium text-primary">· Earned ✓</span>}
          </p>
        </div>
      }
    >
      <MedalFrame tier={badge.tier} art={badge.art} name={badge.name} earned={earned} />
    </Tooltip>
  )
}
