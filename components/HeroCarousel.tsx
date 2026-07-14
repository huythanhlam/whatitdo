'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { readableTextColor } from '@/lib/utils'
import type { EnrichedEvent } from '@/lib/types'

type Props = {
  events: EnrichedEvent[]
  basePath: string
}

const AUTOPLAY_MS = 6000

// Full-bleed rotating showcase of upcoming events for the hero band. Autoplays
// on an interval, pauses on hover/focus, and is fully swipeable via native
// scroll-snap so touch devices get free, janky-free gesture support without
// wiring up pointer events by hand.
export function HeroCarousel({ events, basePath }: Props) {
  const [active, setActive] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const paused = useRef(false)

  const goTo = useCallback((index: number) => {
    const track = trackRef.current
    if (!track) return
    const slide = track.children[index] as HTMLElement | undefined
    slide?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }, [])

  useEffect(() => {
    if (events.length < 2) return
    const id = setInterval(() => {
      if (paused.current) return
      setActive(prev => {
        const next = (prev + 1) % events.length
        goTo(next)
        return next
      })
    }, AUTOPLAY_MS)
    return () => clearInterval(id)
  }, [events.length, goTo])

  // Keep `active` (and thus the dot indicators) in sync when the user swipes
  // or drags the track manually instead of using the arrow buttons.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let raf = 0
    function onScroll() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!track) return
        const slideWidth = track.children[0]?.clientWidth || 1
        const index = Math.round(track.scrollLeft / slideWidth)
        setActive(index)
      })
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      track.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  if (events.length === 0) return null

  function step(dir: 1 | -1) {
    const next = (active + dir + events.length) % events.length
    setActive(next)
    goTo(next)
  }

  return (
    <div
      className="relative w-full"
      onMouseEnter={() => { paused.current = true }}
      onMouseLeave={() => { paused.current = false }}
      onFocus={() => { paused.current = true }}
      onBlur={() => { paused.current = false }}
    >
      <div
        ref={trackRef}
        className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory rounded-2xl shadow-xl shadow-slate-900/10"
        role="region"
        aria-label="Upcoming events showcase"
      >
        {events.map(event => {
          const date = new Date(event.start_time)
          const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          const cat = event.categories?.[0]

          return (
            <Link
              key={event.id}
              href={`${basePath}/events/${event.id}`}
              className="group relative w-full shrink-0 snap-start"
            >
              <div className="relative aspect-[16/9] sm:aspect-[21/9] w-full overflow-hidden bg-slate-800">
                {event.image_url ? (
                  <Image
                    src={event.image_url}
                    alt=""
                    fill
                    priority={event === events[0]}
                    sizes="100vw"
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `radial-gradient(120% 120% at 20% 20%, ${cat?.color ?? '#F17A7E'}55, transparent), linear-gradient(135deg, var(--color-slate-900), var(--color-slate-800))`,
                    }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent" />

                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
                  {cat && (
                    <span
                      className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold mb-3"
                      style={{ backgroundColor: cat.color, color: readableTextColor(cat.color) }}
                    >
                      {cat.name}
                    </span>
                  )}
                  <h3 className="font-display text-2xl sm:text-4xl font-semibold text-white leading-tight max-w-2xl text-balance">
                    {event.title}
                  </h3>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:text-base text-white/85">
                    <span>{dateStr} · {timeStr}</span>
                    {event.venue_name && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {event.venue_name}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {events.length > 1 && (
        <>
          <button
            onClick={() => step(-1)}
            aria-label="Previous event"
            className="absolute left-3 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center w-10 h-10 rounded-full bg-white/90 text-slate-800 shadow-lg hover:bg-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => step(1)}
            aria-label="Next event"
            className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center w-10 h-10 rounded-full bg-white/90 text-slate-800 shadow-lg hover:bg-white transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <div className="absolute bottom-1.5 right-2.5 sm:right-4 flex items-center">
            {events.map((event, i) => (
              // The visible dot stays small (6px) for a tidy indicator row, but
              // the button itself is a full 32px square so it's still easy to
              // tap accurately on a phone.
              <button
                key={event.id}
                onClick={() => { setActive(i); goTo(i) }}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === active}
                className="flex items-center justify-center w-8 h-8"
              >
                <span className={`h-1.5 rounded-full transition-all ${i === active ? 'w-6 bg-white' : 'w-1.5 bg-white/50'}`} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
