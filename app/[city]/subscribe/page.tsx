import Link from 'next/link'
import type { Metadata } from 'next'
import { SubscribeForm } from '@/components/SubscribeForm'
import { requireCity } from '@/lib/cities'
import { getDistinctNeighborhoods } from '@/lib/db'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)

  const title = `Subscribe to ${city.name} Events`
  const description = `Get a daily digest of ${city.name} events in your inbox — concerts, festivals, comedy, food & drink, arts, and more. No spam, ever.`

  // openGraph/twitter are shallowly overwritten (not deep-merged) across nested
  // metadata exports, so siteName/locale/type from the root layout must be
  // repeated here or they'd be dropped for this page.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: 'Whats Happenin',
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function SubscribePage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)
  const neighborhoods = await getDistinctNeighborhoods(city.id)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href={`/${city.slug}`} className="text-sm text-primary hover:underline">← Back to events</Link>
        </div>
      </header>

      <div className="flex items-start justify-center pt-12 pb-20 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <p className="text-4xl mb-3">📬</p>
            <h1 className="text-2xl font-bold mb-2">Get {city.name} events in your inbox</h1>
            <p className="text-sm text-muted-foreground">
              We scan the web daily and send you a curated digest of {city.name} events.
              No spam — ever.
            </p>
          </div>
          <SubscribeForm neighborhoods={neighborhoods} />
        </div>
      </div>
    </div>
  )
}
