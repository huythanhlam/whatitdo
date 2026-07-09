import Link from 'next/link'
import { SubscribeForm } from '@/components/SubscribeForm'
import { requireCity } from '@/lib/cities'

export default async function SubscribePage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params
  const city = await requireCity(citySlug)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link href={`/${city.slug}`} className="text-sm text-violet-600 hover:underline">← Back to events</Link>
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
          <SubscribeForm />
        </div>
      </div>
    </div>
  )
}
