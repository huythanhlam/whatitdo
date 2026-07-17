import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { requireCity } from '@/lib/cities'
import { isRecsCity } from '@/lib/recs/config'
import { ForYouFeed } from '@/components/ForYouFeed'

// Personalized to the visitor and served from a per-request API, so this page
// itself is trivial and must not be statically cached.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'For You',
  description: 'Personalized event recommendations picked for you.',
  robots: { index: false }, // personalized, per-visitor — nothing to index
}

export default async function ForYouPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)
  // Personalization is Austin-only at launch; elsewhere this route doesn't exist.
  if (!isRecsCity(citySlug)) notFound()
  const base = `/${city.slug}`

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/95 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href={base} className="text-sm text-primary hover:underline">← Back to events</Link>
          <span className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" /> {city.name}, {city.state}
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-2xl font-semibold text-foreground mb-1">For You</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Recommendations that learn from what you save, view, and mark interesting.
        </p>
        <ForYouFeed city={city.slug} basePath={base} />
      </div>
    </div>
  )
}
