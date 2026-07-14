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
// pattern, so the RSC can fetch the month window server-side (see app/[city]/page.tsx)
// and hand it here. Month navigation is plain <Link>s — no client fetch, no
// useEffect, no 1000-event client download.
function calParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// Build a homepage URL for a given month, preserving the active filters.
function monthHref(year: number, month: number, filterQs: string, basePath: string): string {
  const qs = new URLSearchParams(filterQs)
  qs.set('view', 'calendar')
  qs.set('cal', calParam(year, month))
  return `${basePath}?${qs.toString()}`
}

export function CalendarView({
  events,
  year,
  month,
  filterQs,
  basePath,
}: {
  events: EnrichedEvent[]
  year: number
  month: number // 0-indexed
  filterQs: string
  basePath: string
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
            href={monthHref(prev.year, prev.month, filterQs, basePath)}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-base font-semibold text-foreground min-w-[10rem] text-center">
            {MONTH_LABELS[month]} {year}
          </h2>
          <Link
            href={monthHref(next.year, next.month, filterQs, basePath)}
            aria-label="Next month"
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
        <Link
          href={monthHref(today.year, today.month, filterQs, basePath)}
          className="text-sm font-medium text-primary hover:text-primary/90 px-2.5 py-1 rounded-md hover:bg-accent transition-colors"
        >
          Today
        </Link>
      </div>

      <div className="relative overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Weekday header */}
          <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            {WEEKDAY_LABELS.map(w => (
              <div key={w} className="px-2 py-1 text-center">
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-px bg-border border border-border rounded-lg overflow-hidden">
            {cells.map(cell => (
              <DayCellView key={cell.key} cell={cell} events={byDay.get(cell.key) ?? []} basePath={basePath} />
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

function DayCellView({ cell, events, basePath }: { cell: DayCell; events: EnrichedEvent[]; basePath: string }) {
  const extra = events.length - MAX_CHIPS

  return (
    <div
      className={`min-h-[7rem] p-1.5 flex flex-col gap-1 ${
        cell.inMonth ? 'bg-card' : 'bg-muted'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
            cell.isToday
              ? 'bg-primary text-primary-foreground'
              : cell.inMonth
              ? 'text-foreground'
              : 'text-muted-foreground'
          }`}
        >
          {cell.d}
        </span>
        {events.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{events.length}</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {events.slice(0, MAX_CHIPS).map(ev => (
          <EventChip key={ev.id} event={ev} basePath={basePath} />
        ))}
        {extra > 0 && (
          <Link
            href={`${basePath}?from=${cell.key}&to=${cell.key}`}
            className="text-[11px] text-primary hover:text-primary/90 hover:underline px-1"
          >
            +{extra} more
          </Link>
        )}
      </div>
    </div>
  )
}

function EventChip({ event, basePath }: { event: EnrichedEvent; basePath: string }) {
  const color = event.categories?.[0]?.color ?? '#F17A7E'
  const time = new Date(event.start_time).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  })

  return (
    <Link
      href={`${basePath}/events/${event.id}`}
      title={`${time} · ${event.title}`}
      className="group block rounded px-1 py-0.5 text-[11px] leading-tight truncate hover:brightness-95 transition"
      style={{ backgroundColor: color + '18', color }}
    >
      <span className="font-medium tabular-nums">{time}</span>{' '}
      <span className="text-foreground">{event.title}</span>
    </Link>
  )
}
