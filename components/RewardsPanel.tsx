import { MedalFrame } from './rewards/MedalFrame'
import { RewardMedal } from './RewardMedal'
import { BADGES, type BadgeGroup } from '@/lib/rewards/catalog'
import type { RewardsSummary } from '@/lib/rewards/data'

// The account-page rewards section: a level hero with progress to the next level,
// total points, and the full badge set grouped by theme (earned in color, locked
// muted so the panel doubles as a "what's next" list). Server component — takes
// the summary the page already synced.

const GROUP_LABELS: Record<BadgeGroup, string> = {
  'getting-started': 'Getting started',
  attendance: 'Attendance',
  'first-of-type': 'First-timer badges',
  taste: 'Curation',
  social: 'Sharing',
  loyalty: 'Loyalty',
}
const GROUP_ORDER: BadgeGroup[] = ['getting-started', 'attendance', 'first-of-type', 'taste', 'social', 'loyalty']

export function RewardsPanel({ summary }: { summary: RewardsSummary }) {
  const earned = new Set(summary.earned.map(e => e.id))
  const earnedCount = earned.size
  const pct = Math.round(summary.progress * 100)

  return (
    <section>
      <h2 className="font-display text-lg font-semibold mb-1">Rewards</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Earn badges by going out, saving events, and coming back. Points add up to your level.
      </p>

      {/* Level hero */}
      <div className="flex items-center gap-4 rounded-xl border bg-card p-4 mb-6">
        <MedalFrame tier={summary.level.tier} centerText={String(summary.points)} name={summary.level.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{summary.level.name}</p>
          <p className="text-xs text-muted-foreground mb-2">
            {summary.points} points · {earnedCount} {earnedCount === 1 ? 'badge' : 'badges'} earned
          </p>
          {summary.next ? (
            <>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {Math.max(0, summary.next.minPoints - summary.points)} points to <strong>{summary.next.name}</strong>
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Top level reached — you&apos;re a legend.</p>
          )}
        </div>
      </div>

      {/* Badges by group */}
      <div className="space-y-6">
        {GROUP_ORDER.map(group => {
          const badges = BADGES.filter(b => b.group === group)
          if (badges.length === 0) return null
          // Earned first within each group.
          const sorted = [...badges].sort((a, b) => Number(earned.has(b.id)) - Number(earned.has(a.id)))
          return (
            <div key={group}>
              <h3 className="text-sm font-medium mb-3">{GROUP_LABELS[group]}</h3>
              <div className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 md:grid-cols-6">
                {sorted.map(b => (
                  <RewardMedal key={b.id} badge={b} earned={earned.has(b.id)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
