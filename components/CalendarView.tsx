'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
import type { Event, Category } from '@/lib/supabase/types'

type EnrichedEvent = Event & { categories?: Category[]; is_featured?: boolean; featured_label?: string | null }

const MAX_CHIPS = 3

// Calendar grid of upcoming events. Fetches the visible month from /api/calendar
// (respecting the active search/category filters) and buckets events by their
// Austin-local day. Past days are simply empty — the app never shows past events.
export function CalendarView() {
  const searchParams = useSearchParams()
  const [{ year, month }, setMonth] = useState(currentCentralMonth) // month: 0-indexed
  const [events, setEvents] = useState<EnrichedEvent[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  // Filters that the calendar should honor, minus view/date-nav params.
  const filterQs = useMemo(() => {
    const qs = new URLSearchParams()
    const q = searchParams.get('q')
    if (q) qs.set('q', q)
    searchParams.getAll('category').forEach(c => qs.append('category', c))
    return qs.toString()
  }, [searchParams])

  // Loading is derived (no synchronous setState in the effect): we're loading
  // whenever the data we hold doesn't match the month + filters being requested.
  const reqKey = `${year}-${month}-${filterQs}`
  const loading = loadedKey !== reqKey

  useEffect(() => {
    let cancelled = false
    const sep = filterQs ? '&' : ''
    fetch(`/api/calendar?year=${year}&month=${month + 1}${sep}${filterQs}`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (!cancelled) setEvents(data.events ?? [])
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(reqKey)
      })
    return () => {
      cancelled = true
    }
  }, [reqKey, year, month, filterQs])

  // Bucket events by their Central-time day key.
  const byDay = useMemo(() => {
    const map = new Map<string, EnrichedEvent[]>()
    for (const ev of events) {
      const key = eventDayKey(ev.start_time)
      const list = map.get(key)
      if (list) list.push(ev)
      else map.set(key, [ev])
    }
    return map
  }, [events])

  const cells = useMemo(() => monthGrid(year, month), [year, month])

  function go(delta: number) {
    setMonth(m => addMonths(m.year, m.month, delta))
  }

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => go(-1)}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-violet-700 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-base font-semibold text-slate-800 min-w-[10rem] text-center">
            {MONTH_LABELS[month]} {year}
          </h2>
          <button
            onClick={() => go(1)}
            aria-label="Next month"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-violet-700 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <button
          onClick={() => setMonth(currentCentralMonth())}
          className="text-sm font-medium text-violet-700 hover:text-violet-900 px-2.5 py-1 rounded-md hover:bg-violet-50 transition-colors"
        >
          Today
        </button>
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

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <span className="text-sm text-slate-500">Loading events…</span>
          </div>
        )}
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
