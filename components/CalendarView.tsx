import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WEEKDAY_LABELS,
  MONTH_LABELS,
  monthGrid,
  eventDayKey,
  currentCentralMonth,
  addMonths,
  type DayCell,
} from '@/lib/calendar'
import type { EnrichedEvent } from '@/lib/types'

const MAX_CHIPS = 3

// The visible month is URL state (?cal=YYYY-MM), matching the app's URL-as-state
// pattern, so the RSC can fetch the month window server-side (see app/page.tsx)
// and hand it here. Month navigation is plain <Link>s — no client fetch, no
// useEffect, no 1000-event client download.
function calParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// Build a homepage URL for a given month, preserving the active filters.
function monthHref(year: number, month: number, filterQs: string): string {
  const qs = new URLSearchParams(filterQs)
  qs.set('view', 'calendar')
  qs.set('cal', calParam(year, month))
  return `/?${qs.toString()}`
}

export function CalendarView({
  events,
  year,
  month,
  filterQs,
}: {
  events: EnrichedEvent[]
  year: number
  month: number // 0-indexed
  filterQs: string
}) {
  const byDay = new Map<string, EnrichedEvent[]>()
  for (const ev of events) {
    const key = eventDayKey(ev.start_time)
    const list = byDay.get(key)
    if (list) list.push(ev)
    else byDay.set(key, [ev])
  }

  const cells = monthGrid(year, month)
  const prev = addMonths(year, month, -1)
  const next = addMonths(year, month, 1)
  const today = currentCentralMonth()

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <Link
            href={monthHref(prev.year, prev.month, filterQs)}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-violet-700 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-base font-semibold text-slate-800 min-w-[10rem] text-center">
            {MONTH_LABELS[month]} {year}
          </h2>
          <Link
            href={monthHref(next.year, next.month, filterQs)}
            aria-label="Next month"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-violet-700 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
        <Link
          href={monthHref(today.year, today.month, filterQs)}
          className="text-sm font-medium text-violet-700 hover:text-violet-900 px-2.5 py-1 rounded-md hover:bg-violet-50 transition-colors"
        >
          Today
        </Link>
      </div>

      <div className="relative overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Weekday header */}
          <div className="grid grid-cols-7 text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
            {WEEKDAY_LABELS.map(w => (
              <div key={w} className="px-2 py-1 text-center">
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {cells.map(cell => (
              <DayCellView key={cell.key} cell={cell} events={byDay.get(cell.key) ?? []} />
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Showing upcoming events only — past days appear empty. Click an event for details, or a day to see its full list.
      </p>
    </div>
  )
}

function DayCellView({ cell, events }: { cell: DayCell; events: EnrichedEvent[] }) {
  const extra = events.length - MAX_CHIPS

  return (
    <div
      className={`min-h-[7rem] p-1.5 flex flex-col gap-1 ${
        cell.inMonth ? 'bg-white' : 'bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
            cell.isToday
              ? 'bg-violet-600 text-white'
              : cell.inMonth
              ? 'text-slate-700'
              : 'text-slate-300'
          }`}
        >
          {cell.d}
        </span>
        {events.length > 0 && (
          <span className="text-[10px] text-slate-400">{events.length}</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {events.slice(0, MAX_CHIPS).map(ev => (
          <EventChip key={ev.id} event={ev} />
        ))}
        {extra > 0 && (
          <Link
            href={`/?from=${cell.key}&to=${cell.key}`}
            className="text-[11px] text-violet-600 hover:text-violet-800 hover:underline px-1"
          >
            +{extra} more
          </Link>
        )}
      </div>
    </div>
  )
}

function EventChip({ event }: { event: EnrichedEvent }) {
  const color = event.categories?.[0]?.color ?? '#7c3aed'
  const time = new Date(event.start_time).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  })

  return (
    <Link
      href={`/events/${event.id}`}
      title={`${time} · ${event.title}`}
      className="group block rounded px-1 py-0.5 text-[11px] leading-tight truncate hover:brightness-95 transition"
      style={{ backgroundColor: color + '18', color }}
    >
      <span className="font-medium tabular-nums">{time}</span>{' '}
      <span className="text-slate-700 group-hover:text-slate-900">{event.title}</span>
    </Link>
  )
}
