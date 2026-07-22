// Shown while the event-detail segment streams in. The page is ISR-cached
// (revalidate = 900), so this appears on a cache miss / client navigation before
// the fetch resolves. Mirrors the detail layout below (hero image, badges, title,
// meta rows, action buttons) so the skeleton settles into content without a jump.
export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="h-5 w-28 bg-muted rounded animate-pulse" />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="w-full h-64 rounded-xl bg-muted animate-pulse mb-6" />

        <div className="flex gap-1 mb-3">
          <div className="h-5 w-16 bg-muted rounded-full animate-pulse" />
          <div className="h-5 w-20 bg-muted rounded-full animate-pulse" />
        </div>

        <div className="h-8 w-3/4 bg-muted rounded animate-pulse mb-4" />

        <div className="space-y-2 mb-6">
          <div className="h-4 w-64 bg-muted rounded animate-pulse" />
          <div className="h-4 w-52 bg-muted rounded animate-pulse" />
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        </div>

        <div className="space-y-2 mb-6">
          <div className="h-4 w-full bg-muted rounded animate-pulse" />
          <div className="h-4 w-full bg-muted rounded animate-pulse" />
          <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
        </div>

        <div className="flex gap-3">
          <div className="h-9 w-36 bg-muted rounded-md animate-pulse" />
          <div className="h-9 w-32 bg-muted rounded-md animate-pulse" />
        </div>
      </div>
    </div>
  )
}
