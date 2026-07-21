import { Emblem } from './emblems'
import type { MedalTier } from '@/lib/rewards/catalog'

// The medallion shell: a full-bleed illustrated scene (lib/rewards/art) clipped
// to a disc, inside a thin tier ring. Earned medals show in full color; locked
// ones are desaturated with a small lock. The tier ring is the only progression
// cue — the scene itself is the same whether bronze or platinum.

const TIER_RING: Record<MedalTier, string> = {
  slate: 'linear-gradient(145deg,#c2ccd6,#8b95a1)',
  bronze: 'linear-gradient(145deg,#dca078,#a15c30)',
  silver: 'linear-gradient(145deg,#e6ecf2,#9aa7b5)',
  gold: 'linear-gradient(145deg,#f4d788,#d3a52c)',
  platinum: 'linear-gradient(145deg,#eef5f8,#a9c3cf)',
}
const TIER_FG: Record<MedalTier, string> = {
  slate: '#64748b', bronze: '#b06a38', silver: '#7f8c9b', gold: '#bd8f1f', platinum: '#4f7c8f',
}

const SIZES = {
  md: { ring: 66, disc: 58, pad: 3, text: 'text-[11px]' },
  lg: { ring: 96, disc: 86, pad: 4, text: 'text-sm' },
} as const

export function MedalFrame({
  tier,
  art,
  centerText,
  name,
  earned = true,
  size = 'md',
  title,
}: {
  tier: MedalTier
  art?: string
  centerText?: string
  name?: string
  earned?: boolean
  size?: keyof typeof SIZES
  title?: string
}) {
  const s = SIZES[size]

  return (
    <div className="flex flex-col items-center gap-1.5" title={title}>
      <div
        className="relative rounded-full shadow-sm"
        style={{ width: s.ring, height: s.ring, padding: s.pad, background: earned ? TIER_RING[tier] : 'var(--border)' }}
      >
        <div
          className="relative rounded-full overflow-hidden flex items-center justify-center"
          style={{
            width: s.disc,
            height: s.disc,
            background: art ? 'transparent' : 'var(--card)',
            filter: earned ? undefined : 'grayscale(1)',
            opacity: earned ? 1 : 0.55,
          }}
        >
          {art ? (
            <Emblem art={art} className="block h-full w-full" />
          ) : (
            <span className="font-display font-semibold" style={{ color: TIER_FG[tier], fontSize: s.disc * 0.32 }}>
              {centerText}
            </span>
          )}
        </div>
        {!earned && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-card">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2.4}>
              <rect x="5" y="11" width="14" height="9" rx="1.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
        )}
      </div>
      {name && (
        <span
          className={`${s.text} font-medium text-center leading-tight ${earned ? 'text-foreground' : 'text-muted-foreground'}`}
          style={{ maxWidth: s.ring + 26 }}
        >
          {name}
        </span>
      )}
    </div>
  )
}
