// Month-grid helpers for the calendar view. Calendar days are anchored to
// Austin local time (Central) so an event's "day" matches what a local user
// would expect, regardless of the viewer's own timezone.

import { TZ, partsInTz, zonedToUtc } from './dateRanges'

export type DayCell = {
  y: number
  m: number // 0-indexed
  d: number
  key: string // yyyy-mm-dd
  inMonth: boolean
  isToday: boolean
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function ymdKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// The Central-time calendar day (yyyy-mm-dd) an event's start_time falls on.
export function eventDayKey(iso: string): string {
  const { y, m, d } = partsInTz(new Date(iso), TZ)
  return ymdKey(y, m, d)
}

// The current month in Central time.
export function currentCentralMonth(): { year: number; month: number } {
  const { y, m } = partsInTz(new Date(), TZ)
  return { year: y, month: m }
}

// Step a {year, month} pair by `delta` months, normalizing overflow.
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

// A 6-week (42-cell) grid for the given month, weeks starting Sunday. Cells
// outside the month are included (greyed in the UI) so every week is full.
// Civil-date arithmetic is done in UTC — which has no DST — so adding 24h
// always advances exactly one calendar day without drift.
export function monthGrid(year: number, month: number): DayCell[] {
  const todayKey = eventDayKey(new Date().toISOString())
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0=Sun
  const start = new Date(Date.UTC(year, month, 1 - firstWeekday))
  const cells: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start.getTime() + i * 86_400_000)
    const y = dt.getUTCFullYear()
    const m = dt.getUTCMonth()
    const d = dt.getUTCDate()
    const key = ymdKey(y, m, d)
    cells.push({ y, m, d, key, inMonth: m === month, isToday: key === todayKey })
  }
  return cells
}

// UTC ISO bounds covering the full visible grid (first cell 00:00 → last cell
// 23:59:59, both in Central). Used to fetch every event the grid can show.
export function gridRangeIso(year: number, month: number): { fromIso: string; toIso: string } {
  const cells = monthGrid(year, month)
  const first = cells[0]
  const last = cells[cells.length - 1]
  return {
    fromIso: zonedToUtc(first.y, first.m, first.d, 0, 0, 0, TZ).toISOString(),
    toIso: zonedToUtc(last.y, last.m, last.d, 23, 59, 59, TZ).toISOString(),
  }
}
