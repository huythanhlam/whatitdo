'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, CalendarDays } from 'lucide-react'

// Switches the home page between the card grid and the calendar view via the
// `view` URL param, preserving all other active filters.
export function ViewToggle() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = searchParams.get('view') === 'calendar' ? 'calendar' : 'grid'

  function setView(next: 'grid' | 'calendar') {
    if (next === view) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'calendar') params.set('view', 'calendar')
    else params.delete('view')
    params.delete('page')
    router.push(`/?${params.toString()}`)
  }

  const btn = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:text-violet-700'
    }`

  return (
    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
      <button onClick={() => setView('grid')} className={btn(view === 'grid')} aria-pressed={view === 'grid'}>
        <LayoutGrid className="w-4 h-4" />
        <span className="hidden sm:inline">Grid</span>
      </button>
      <button
        onClick={() => setView('calendar')}
        className={`${btn(view === 'calendar')} border-l border-slate-200`}
        aria-pressed={view === 'calendar'}
      >
        <CalendarDays className="w-4 h-4" />
        <span className="hidden sm:inline">Calendar</span>
      </button>
    </div>
  )
}
