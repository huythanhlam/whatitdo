'use client'
import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Music, Laugh, UtensilsCrossed, Palette, Trophy, Users,
  PartyPopper, Clapperboard, TreePine, Handshake, Sparkles,
  ChevronLeft, ChevronRight, type LucideIcon,
} from 'lucide-react'
import { CATEGORIES, type CategorySlug } from '@/lib/categories'

const ICONS: Record<CategorySlug, LucideIcon> = {
  music: Music,
  comedy: Laugh,
  'food-drink': UtensilsCrossed,
  arts: Palette,
  sports: Trophy,
  family: Users,
  festivals: PartyPopper,
  film: Clapperboard,
  outdoors: TreePine,
  networking: Handshake,
  other: Sparkles,
}

// A Meetup/Eventbrite-style "browse by category" rail: big tappable icon tiles
// that deep-link straight into the filtered results below, distinct from
// SidebarFilters' checkbox facets (which stay for refining once you're
// already browsing a result set).
//
// When `gated` (a logged-out visitor on a recs city), tiles route through the
// /join registration gate carrying the category intent instead of jumping
// straight to the filtered list; the gate hands them back here (filtered) once
// they've signed in and onboarded.
export function CategoryCarousel({ basePath, gated = false }: { basePath: string; gated?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateScrollState() {
    const el = trackRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    updateScrollState()
    const el = trackRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [])

  function scrollBy(dir: 1 | -1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      {canScrollLeft && (
        <>
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-r from-background to-transparent" />
          <button
            onClick={() => scrollBy(-1)}
            aria-label="Scroll categories left"
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-card border border-border shadow-sm hover:border-primary hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </>
      )}

      <div
        ref={trackRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth px-1 py-1"
      >
        {CATEGORIES.map(cat => {
          const Icon = ICONS[cat.slug]
          const href = gated
            ? `${basePath}/join?intent=category&cat=${cat.slug}`
            : `${basePath}?category=${cat.slug}#events`
          return (
            <Link
              key={cat.slug}
              href={href}
              className="group flex shrink-0 flex-col items-center gap-2 w-20 sm:w-24"
            >
              <span
                className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-md"
                style={{ backgroundColor: cat.color + '1c', color: cat.color }}
              >
                <Icon className="w-6 h-6 sm:w-7 sm:h-7" strokeWidth={1.75} />
              </span>
              <span className="text-xs sm:text-sm font-medium text-center leading-tight text-foreground/85 group-hover:text-primary transition-colors">
                {cat.name}
              </span>
            </Link>
          )
        })}
      </div>

      {canScrollRight && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 z-10 bg-gradient-to-l from-background to-transparent" />
          <button
            onClick={() => scrollBy(1)}
            aria-label="Scroll categories right"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-card border border-border shadow-sm hover:border-primary hover:text-primary transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  )
}
