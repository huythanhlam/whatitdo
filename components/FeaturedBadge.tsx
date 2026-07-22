import { Star } from 'lucide-react'

export function FeaturedBadge({ label = 'Featured' }: { label?: string }) {
  return (
    <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 bg-primary text-primary-foreground text-xs font-semibold px-2 py-0.5 rounded-full shadow-sm">
      <Star className="w-3 h-3 fill-current" aria-hidden="true" /> {label}
    </span>
  )
}
