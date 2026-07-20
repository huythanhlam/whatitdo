import { describe, it, expect } from 'vitest'
import { computeCounts, evaluateBadges, levelFor, pointsFor, type RewardInput, type InteractionLite, type AttendedEventLite } from './engine'

const DAY = 86_400_000
const NOW = Date.parse('2026-07-19T12:00:00Z')

function input(over: Partial<RewardInput> = {}): RewardInput {
  return {
    interactions: [],
    attendedEvents: [],
    onboarded: false,
    subscribed: false,
    accountCreatedAt: NOW,
    now: NOW,
    ...over,
  }
}

const int = (type: string, eventId: string | null, createdAt: number): InteractionLite => ({ type, eventId, createdAt })
const att = (eventId: string, startTime: number, categorySlugs: string[] = []): AttendedEventLite => ({ eventId, startTime, categorySlugs })

describe('computeCounts — net resolution & dedup', () => {
  it('favorite → unfavorite → favorite nets to saved once', () => {
    const c = computeCounts(input({
      interactions: [
        int('favorite', 'e1', 1),
        int('unfavorite', 'e1', 2),
        int('favorite', 'e1', 3),
      ],
    }))
    expect(c.saved).toBe(1)
  })

  it('a favorite later unfavorited does not count as saved', () => {
    const c = computeCounts(input({
      interactions: [int('favorite', 'e1', 1), int('unfavorite', 'e1', 2)],
    }))
    expect(c.saved).toBe(0)
  })

  it('saved unions favorites and interested across distinct events', () => {
    const c = computeCounts(input({
      interactions: [int('favorite', 'e1', 1), int('interested', 'e2', 1), int('interested', 'e1', 1)],
    }))
    expect(c.saved).toBe(2) // e1 (fav+interested) counted once, e2 once
  })

  it('duplicate attended rows for the same event count once', () => {
    const c = computeCounts(input({
      attendedEvents: [att('e1', NOW, ['music']), att('e1', NOW, ['music'])],
    }))
    expect(c.attended).toBe(1)
  })

  it('counts calendar adds by distinct event, shares/searches by total', () => {
    const c = computeCounts(input({
      interactions: [
        int('calendar_add', 'e1', 1), int('calendar_add', 'e1', 2), int('calendar_add', 'e2', 3),
        int('share', 'e1', 1), int('share', 'e2', 2),
        int('search', null, 1), int('search', null, 2), int('search', null, 3),
      ],
    }))
    expect(c.calendarAdds).toBe(2)
    expect(c.shares).toBe(2)
    expect(c.searches).toBe(3)
  })

  it('activeDays counts distinct calendar days', () => {
    const c = computeCounts(input({
      interactions: [int('view', 'e1', 5 * DAY), int('view', 'e2', 5 * DAY + 100), int('view', 'e3', 9 * DAY)],
    }))
    expect(c.activeDays).toBe(2)
  })

  it('derives category tallies from attended events', () => {
    const c = computeCounts(input({
      attendedEvents: [att('e1', NOW, ['music', 'arts']), att('e2', NOW, ['music'])],
    }))
    expect(c.attendedByCategory.music).toBe(2)
    expect(c.attendedByCategory.arts).toBe(1)
    expect(c.distinctCategoriesAttended).toBe(2)
  })
})

describe('computeCounts — weekends & streaks', () => {
  const saturdays = [
    Date.parse('2026-01-03T20:00:00Z'),
    Date.parse('2026-01-10T20:00:00Z'),
    Date.parse('2026-01-17T20:00:00Z'),
    Date.parse('2026-01-24T20:00:00Z'),
    Date.parse('2026-01-31T20:00:00Z'),
  ]

  it('counts distinct weekends for weekend attendances', () => {
    const c = computeCounts(input({ attendedEvents: saturdays.map((s, i) => att(`e${i}`, s, ['music'])) }))
    expect(c.weekendAttendances).toBe(5)
  })

  it('finds the longest run of consecutive weeks', () => {
    // Five consecutive Saturdays → streak of 5.
    const c = computeCounts(input({ attendedEvents: saturdays.map((s, i) => att(`e${i}`, s)) }))
    expect(c.longestWeeklyStreak).toBe(5)
  })

  it('a gap breaks the streak', () => {
    const gapped = [saturdays[0], saturdays[1], saturdays[3], saturdays[4]] // missing week 3
    const c = computeCounts(input({ attendedEvents: gapped.map((s, i) => att(`e${i}`, s)) }))
    expect(c.longestWeeklyStreak).toBe(2)
  })
})

describe('computeCounts — account age', () => {
  it('computes account age in days', () => {
    const c = computeCounts(input({ accountCreatedAt: NOW - 400 * DAY }))
    expect(c.accountAgeDays).toBe(400)
  })
  it('handles a missing account creation date', () => {
    const c = computeCounts(input({ accountCreatedAt: null }))
    expect(c.accountAgeDays).toBe(0)
  })
})

describe('evaluateBadges — thresholds', () => {
  it('welcome_aboard is always earned', () => {
    expect(evaluateBadges(computeCounts(input()))).toContain('welcome_aboard')
  })

  it('attendance chain unlocks at its boundaries', () => {
    const mk = (n: number) => computeCounts(input({ attendedEvents: Array.from({ length: n }, (_, i) => att(`e${i}`, NOW)) }))
    expect(evaluateBadges(mk(1))).toContain('first_timer')
    expect(evaluateBadges(mk(4))).not.toContain('regular')
    expect(evaluateBadges(mk(5))).toContain('regular')
    expect(evaluateBadges(mk(14))).not.toContain('scene_fixture')
    expect(evaluateBadges(mk(15))).toContain('scene_fixture')
  })

  it('first-of-type unlocks per category', () => {
    const c = computeCounts(input({ attendedEvents: [att('e1', NOW, ['comedy'])] }))
    const ids = evaluateBadges(c)
    expect(ids).toContain('first_comedy')
    expect(ids).not.toContain('first_music')
  })

  it('profile milestones respect their flags', () => {
    expect(evaluateBadges(computeCounts(input({ onboarded: true })))).toContain('know_thyself')
    expect(evaluateBadges(computeCounts(input({ subscribed: true })))).toContain('in_the_loop')
  })
})

describe('levelFor — boundaries', () => {
  it('maps points to the right level at exact thresholds', () => {
    expect(levelFor(0).level.id).toBe('newcomer')
    expect(levelFor(39).level.id).toBe('newcomer')
    expect(levelFor(40).level.id).toBe('explorer')
    expect(levelFor(100).level.id).toBe('regular')
    expect(levelFor(350).level.id).toBe('local_legend')
  })

  it('the top level has no next and full progress', () => {
    const top = levelFor(999)
    expect(top.next).toBeNull()
    expect(top.progress).toBe(1)
  })

  it('progress is the fraction toward the next level', () => {
    // Explorer floor 40, next Regular floor 100 → 70 is halfway.
    expect(levelFor(70).progress).toBeCloseTo(0.5, 5)
  })
})

describe('pointsFor', () => {
  it('sums known badge points and ignores unknown ids', () => {
    expect(pointsFor(['welcome_aboard'])).toBe(5)
    expect(pointsFor(['nope_not_real'])).toBe(0)
  })
})
