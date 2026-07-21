// The reward catalog: badge definitions + level thresholds, as pure data.
//
// This is the single source of truth for what can be earned. It lives in code
// (not the DB) so achievements are versioned in git, the engine can be a pure
// function of static config, and adding/removing a badge is a one-line change
// with no migration. The DB only records WHICH badges a user earned and WHEN
// (see supabase/migrations/039_rewards.sql); points and level are derived.
//
// Every badge maps to a custom SVG emblem via `art` (see components/rewards/
// emblems.tsx) — no emoji, no icon font. `tier` picks the medal's metal ring.

import { CATEGORY_SLUGS, getCategoryBySlug } from '@/lib/categories'

export type MedalTier = 'slate' | 'bronze' | 'silver' | 'gold' | 'platinum'

export type BadgeGroup =
  | 'getting-started'
  | 'attendance'
  | 'first-of-type'
  | 'taste'
  | 'social'
  | 'loyalty'

// The tallies the engine derives from a user's history. Badges are predicates
// over this shape; keep it flat and cheap so the engine stays a pure function.
export type RewardCounts = {
  // engagement (from `interactions`)
  saved: number                 // distinct events currently favorited or interested (net)
  calendarAdds: number          // distinct events added to a calendar
  shares: number                // total share actions
  searches: number              // total searches run
  digestClicks: number          // total digest click-throughs
  // attendance (the `attended` interaction, joined to event categories/times)
  attended: number              // distinct events checked into
  attendedByCategory: Record<string, number> // category slug -> distinct attended events
  distinctCategoriesAttended: number
  weekendAttendances: number    // distinct weekends with a Sat/Sun event attended
  longestWeeklyStreak: number   // longest run of consecutive ISO weeks with an attendance
  // profile milestones
  onboarded: boolean            // completed the onboarding survey
  subscribed: boolean           // has a confirmed email-digest subscription
  accountAgeDays: number        // days since the account was created
  // cadence
  activeDays: number            // distinct calendar days with any interaction
  total: number                 // total interactions (handy for tests/debug)
}

export type BadgeDef = {
  id: string
  name: string
  description: string
  art: string                   // emblem registry key (components/rewards/emblems.tsx)
  tier: MedalTier
  group: BadgeGroup
  points: number
  requires: (c: RewardCounts) => boolean
}

export type Level = {
  id: string
  name: string
  minPoints: number
  tier: MedalTier
}

// --- First-of-type badges, one per category -------------------------------
// Custom names + emblems per category; generated so the set tracks lib/categories.
const CATEGORY_BADGE_META: Record<string, { name: string; art: string }> = {
  music:        { name: 'First Encore',   art: 'note' },
  comedy:       { name: 'Laugh Track',    art: 'mask' },
  'food-drink': { name: 'Fork & Knife',   art: 'plate' },
  arts:         { name: 'Framed',         art: 'frame' },
  sports:       { name: 'Team Player',    art: 'ball' },
  family:       { name: 'Family Outing',  art: 'people' },
  festivals:    { name: 'Festivalgoer',   art: 'burst' },
  film:         { name: 'Now Showing',    art: 'reel' },
  outdoors:     { name: 'Fresh Air',      art: 'mountain' },
  networking:   { name: 'Connected',      art: 'nodes' },
  other:        { name: 'Wildcard',       art: 'star' },
}

const FIRST_OF_TYPE: BadgeDef[] = CATEGORY_SLUGS.map(slug => {
  const meta = CATEGORY_BADGE_META[slug] ?? { name: `First ${slug}`, art: 'star' }
  const label = getCategoryBySlug(slug)?.name ?? slug
  return {
    id: `first_${slug}`,
    name: meta.name,
    description: `Attended your first ${label} event`,
    art: meta.art,
    tier: 'bronze' as const,
    group: 'first-of-type' as const,
    points: 10,
    requires: (c: RewardCounts) => (c.attendedByCategory[slug] ?? 0) >= 1,
  }
})

// The number of categories that count toward "every category".
const CATEGORY_COUNT = CATEGORY_SLUGS.length

export const BADGES: BadgeDef[] = [
  // --- Group A: Getting Started ---
  {
    id: 'welcome_aboard', name: 'Welcome Aboard',
    description: 'Created your account and joined the scene',
    art: 'door', tier: 'bronze', group: 'getting-started', points: 5,
    requires: () => true,
  },
  {
    id: 'know_thyself', name: 'Know Thyself',
    description: 'Completed the onboarding interest survey',
    art: 'compass', tier: 'bronze', group: 'getting-started', points: 10,
    requires: c => c.onboarded,
  },
  {
    id: 'in_the_loop', name: 'In the Loop',
    description: 'Subscribed to the email digest',
    art: 'envelope', tier: 'silver', group: 'getting-started', points: 15,
    requires: c => c.subscribed,
  },
  {
    id: 'digest_devotee', name: 'Digest Devotee',
    description: 'Clicked through from three digest emails',
    art: 'letter-check', tier: 'silver', group: 'getting-started', points: 15,
    requires: c => c.digestClicks >= 3,
  },

  // --- Group B: Attendance (the flagship chain) ---
  {
    id: 'first_timer', name: 'First Timer',
    description: 'Checked into your first event',
    art: 'ticket', tier: 'bronze', group: 'attendance', points: 15,
    requires: c => c.attended >= 1,
  },
  {
    id: 'regular', name: 'Regular',
    description: 'Attended five events',
    art: 'tickets', tier: 'silver', group: 'attendance', points: 25,
    requires: c => c.attended >= 5,
  },
  {
    id: 'scene_fixture', name: 'Scene Fixture',
    description: 'Attended fifteen events',
    art: 'marquee', tier: 'gold', group: 'attendance', points: 40,
    requires: c => c.attended >= 15,
  },
  {
    id: 'local_legend', name: 'Local Legend',
    description: 'Attended forty events',
    art: 'trophy', tier: 'platinum', group: 'attendance', points: 80,
    requires: c => c.attended >= 40,
  },
  {
    id: 'weekend_warrior', name: 'Weekend Warrior',
    description: 'Attended events on five different weekends',
    art: 'sunrise', tier: 'silver', group: 'attendance', points: 25,
    requires: c => c.weekendAttendances >= 5,
  },
  {
    id: 'on_a_roll', name: 'On a Roll',
    description: 'Attended at least one event four weeks in a row',
    art: 'chevrons', tier: 'gold', group: 'attendance', points: 30,
    requires: c => c.longestWeeklyStreak >= 4,
  },

  // --- Group C: First-of-Type (generated per category) ---
  ...FIRST_OF_TYPE,
  {
    id: 'well_rounded', name: 'Well-Rounded',
    description: 'Attended events across five distinct categories',
    art: 'wheel', tier: 'gold', group: 'first-of-type', points: 30,
    requires: c => c.distinctCategoriesAttended >= 5,
  },
  {
    id: 'full_menu', name: 'The Full Menu',
    description: 'Attended an event in every category',
    art: 'grid', tier: 'platinum', group: 'first-of-type', points: 60,
    requires: c => c.distinctCategoriesAttended >= CATEGORY_COUNT,
  },

  // --- Group D: Taste / Curation ---
  {
    id: 'wishlist_wizard', name: 'Wishlist Wizard',
    description: 'Saved twenty-five events',
    art: 'bookmark', tier: 'silver', group: 'taste', points: 20,
    requires: c => c.saved >= 25,
  },
  {
    id: 'planner', name: 'Planner',
    description: 'Added ten events to your calendar',
    art: 'calendar', tier: 'silver', group: 'taste', points: 20,
    requires: c => c.calendarAdds >= 10,
  },
  {
    id: 'detective', name: 'Detective',
    description: 'Ran ten searches',
    art: 'magnifier', tier: 'bronze', group: 'taste', points: 10,
    requires: c => c.searches >= 10,
  },

  // --- Group E: Social ---
  {
    id: 'town_crier', name: 'Town Crier',
    description: 'Shared your first event',
    art: 'megaphone', tier: 'bronze', group: 'social', points: 10,
    requires: c => c.shares >= 1,
  },
  {
    id: 'megaphone', name: 'Megaphone',
    description: 'Shared ten events',
    art: 'megaphone', tier: 'silver', group: 'social', points: 20,
    requires: c => c.shares >= 10,
  },

  // --- Group F: Loyalty / Cadence ---
  {
    id: 'seasoned', name: 'Seasoned',
    description: 'Active on thirty different days',
    art: 'rings', tier: 'gold', group: 'loyalty', points: 30,
    requires: c => c.activeDays >= 30,
  },
  {
    id: 'one_year_local', name: 'One-Year Local',
    description: 'A year in, with ten events under your belt',
    art: 'rosette', tier: 'gold', group: 'loyalty', points: 40,
    requires: c => c.accountAgeDays >= 365 && c.attended >= 10,
  },
]

// Display metadata for the badge groups, shared by the account RewardsPanel and
// the /rewards catalog page so both render the same labels in the same order.
export const GROUP_LABELS: Record<BadgeGroup, string> = {
  'getting-started': 'Getting started',
  attendance: 'Attendance',
  'first-of-type': 'First-timer badges',
  taste: 'Curation',
  social: 'Sharing',
  loyalty: 'Loyalty',
}
export const GROUP_ORDER: BadgeGroup[] = ['getting-started', 'attendance', 'first-of-type', 'taste', 'social', 'loyalty']

export const LEVELS: Level[] = [
  { id: 'newcomer',     name: 'Newcomer',     minPoints: 0,   tier: 'slate' },
  { id: 'explorer',     name: 'Explorer',     minPoints: 40,  tier: 'bronze' },
  { id: 'regular',      name: 'Regular',      minPoints: 100, tier: 'silver' },
  { id: 'insider',      name: 'Insider',      minPoints: 200, tier: 'gold' },
  { id: 'local_legend', name: 'Local Legend', minPoints: 350, tier: 'platinum' },
]

const BADGES_BY_ID = new Map(BADGES.map(b => [b.id, b]))
export function getBadge(id: string): BadgeDef | undefined {
  return BADGES_BY_ID.get(id)
}
