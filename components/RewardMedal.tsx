import { MedalFrame } from './rewards/MedalFrame'
import type { BadgeDef } from '@/lib/rewards/catalog'

// One badge, rendered as its custom medal. Locked badges show muted with the
// description as a hint (so the panel doubles as a "what's next" list).
export function RewardMedal({ badge, earned, size = 'md' }: { badge: BadgeDef; earned: boolean; size?: 'md' | 'lg' }) {
  return (
    <MedalFrame
      tier={badge.tier}
      art={badge.art}
      name={badge.name}
      earned={earned}
      size={size}
      title={earned ? badge.description : `Locked — ${badge.description}`}
    />
  )
}
