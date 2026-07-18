// Shared past/future logic for the account event lists (Interested / Not
// interested). Kept pure and framework-free so it can be unit-tested and reused:
// the component only handles rendering.

export type DateFilter = 'upcoming' | 'past' | 'all'

// Parse an event start into epoch millis. Unparseable/missing dates return
// -Infinity so they sort to the very end and are never treated as "passed" —
// they should never be silently dropped from the default upcoming view.
export function eventStartMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

// Whether an event's start has already passed relative to `now` (epoch millis).
export function isPastEvent(iso: string, now: number): boolean {
  const ms = eventStartMs(iso)
  return ms !== -Infinity && ms < now
}

// Apply the date filter and sort by date descending, so the oldest events always
// land at the end. Each result is tagged `past` for the dimmed indicator.
//   - 'upcoming' (default): only events that haven't passed
//   - 'past':     only events that have passed
//   - 'all':      everything
export function filterAndSortByDate<T extends { start_time: string }>(
  items: T[],
  now: number,
  filter: DateFilter,
): { item: T; past: boolean }[] {
  return items
    .map(item => {
      const ms = eventStartMs(item.start_time)
      return { item, ms, past: ms !== -Infinity && ms < now }
    })
    .filter(m => (filter === 'all' ? true : filter === 'past' ? m.past : !m.past))
    .sort((a, b) => b.ms - a.ms)
    .map(({ item, past }) => ({ item, past }))
}
