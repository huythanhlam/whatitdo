export function FeaturedBadge({ label = 'Featured' }: { label?: string }) {
  return (
    <span className="absolute top-2 left-2 z-10 bg-violet-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full shadow-sm">
      ⭐ {label}
    </span>
  )
}
