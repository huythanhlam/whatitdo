'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { LayoutGrid, CalendarDays, MapPin } from 'lucide-react'

// Switches the home page between the card grid, calendar, and map views via
// the `view` URL param, preserving all other active filters.
export function ViewToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const rawView = searchParams.get('view')
  const view = rawView === 'calendar' ? 'calendar' : rawView === 'map' ? 'map' : 'grid'
  // NEXT_PUBLIC_ vars are inlined at build time, so this is safe to read
  // directly here — mirrors the same check components/MapView.tsx makes.
  // Hides the Map button on deployments where it would only lead to a
  // permanent "not configured" dead end.
  const mapsConfigured = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  function setView(next: 'grid' | 'calendar' | 'map') {
    if (next === view) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'grid') params.delete('view')
    else params.set('view', next)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  const btn = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-primary'
    }`

  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden shrink-0">
      <button onClick={() => setView('grid')} className={btn(view === 'grid')} aria-pressed={view === 'grid'}>
        <LayoutGrid className="w-4 h-4" />
        <span className="hidden sm:inline">Grid</span>
      </button>
      <button
        onClick={() => setView('calendar')}
        className={`${btn(view === 'calendar')} border-l border-border`}
        aria-pressed={view === 'calendar'}
      >
        <CalendarDays className="w-4 h-4" />
        <span className="hidden sm:inline">Calendar</span>
      </button>
      {mapsConfigured && (
        <button
          onClick={() => setView('map')}
          className={`${btn(view === 'map')} border-l border-border`}
          aria-pressed={view === 'map'}
        >
          <MapPin className="w-4 h-4" />
          <span className="hidden sm:inline">Map</span>
        </button>
      )}
    </div>
  )
}
