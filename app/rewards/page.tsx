import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getUser } from '@/lib/auth/server'
import { getRewardsSummary, emptySummary, type RewardsSummary } from '@/lib/rewards/data'
import { BADGES, LEVELS, GROUP_LABELS, GROUP_ORDER } from '@/lib/rewards/catalog'
import { MedalFrame } from '@/components/rewards/MedalFrame'
import { Tooltip } from '@/components/rewards/Tooltip'
import { BadgeDetailCard } from '@/components/rewards/BadgeDetailCard'

// The public badges & rewards catalog. Reads the session so signed-in users see
// which badges they've earned and their level progress, but it is strictly
// read-only — it calls getRewardsSummary, never syncRewards, so browsing the
// catalog never awards or mutates anything. Dynamic (reads the session) yet still
// indexable: the catalog itself is public and identical for everyone.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Badges & Rewards',
  description: 'Every badge you can earn and how to unlock each one.',
}

const RECS_CITY = 'austin'

export default async function RewardsPage() {
  let summary: RewardsSummary = emptySummary()
  let signedIn = false
  try {
    const { supabase, user } = await getUser()
    if (user) {
      signedIn = true
      summary = await getRewardsSummary(supabase)
    }
  } catch {
    // Fall back to the signed-out (all-locked) catalog rather than erroring.
  }

  const earned = new Set(summary.earned.map(e => e.id))
  const currentLevelId = signedIn ? summary.level.id : null
  const pct = Math.round(summary.progress * 100)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href={`/${RECS_CITY}`} aria-label="Whats Happenin" className="flex items-center gap-2 shrink-0">
            <Image src="/logo-icon.svg" alt="" aria-hidden="true" width={32} height={32} className="h-8 w-8 rounded-lg" priority />
            <span className="font-display text-lg font-semibold tracking-tight text-foreground whitespace-nowrap">Whats Happenin</span>
          </Link>
          <Link href="/account" className="text-sm text-primary hover:underline shrink-0">Your account</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="font-display text-2xl font-semibold mb-2">Badges &amp; Rewards</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Earn badges by going out, saving events, and coming back — points add up to your level.
          Each badge below shows exactly how to unlock it.
        </p>

        {signedIn && (
          <div className="flex items-center gap-4 rounded-xl border bg-card p-4 mb-10">
            <MedalFrame tier={summary.level.tier} centerText={String(summary.points)} name={summary.level.name} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{summary.level.name}</p>
              <p className="text-xs text-muted-foreground mb-2">
                {summary.points} points · {earned.size} {earned.size === 1 ? 'badge' : 'badges'} earned
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
        )}

        {/* Levels */}
        <section className="mb-12">
          <h2 className="font-display text-lg font-semibold mb-1">Levels</h2>
          <p className="text-sm text-muted-foreground mb-5">Rack up points to climb from Newcomer to Local Legend.</p>
          <div className="grid grid-cols-3 gap-x-2 gap-y-6 sm:grid-cols-5">
            {LEVELS.map(level => (
              <Tooltip
                key={level.id}
                content={
                  <div className="text-left">
                    <p className="text-sm font-semibold">{level.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {level.minPoints === 0 ? 'Starting level' : `Reach ${level.minPoints} points`}
                    </p>
                  </div>
                }
              >
                <MedalFrame tier={level.tier} centerText={String(level.minPoints)} name={level.name} />
                {currentLevelId === level.id && (
                  <span className="mt-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    You&apos;re here
                  </span>
                )}
              </Tooltip>
            ))}
          </div>
        </section>

        {/* Badges by group */}
        <section>
          <h2 className="font-display text-lg font-semibold mb-5">Badges</h2>
          <div className="space-y-8">
            {GROUP_ORDER.map(group => {
              const badges = BADGES.filter(b => b.group === group)
              if (badges.length === 0) return null
              return (
                <div key={group}>
                  <h3 className="text-sm font-medium mb-3">{GROUP_LABELS[group]}</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {badges.map(b => (
                      <BadgeDetailCard key={b.id} badge={b} earned={earned.has(b.id)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
