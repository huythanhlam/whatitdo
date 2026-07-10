import { getEnabledCities } from '@/lib/db'
import { BackToEventsLink } from '@/components/BackToEventsLink'

// Rendered when a route segment calls notFound() (e.g. an unknown event id on
// app/[city]/events/[id]) or an unmatched path. This always renders at the
// root — it never receives the [city] param — so the link below resolves the
// city client-side instead of defaulting to the first enabled city.
export default async function NotFound() {
  const cities = await getEnabledCities()
  const citySlugs = cities.map(c => c.slug)

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-xl font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-6">
          That event or page doesn&apos;t exist or may have ended.
        </p>
        <BackToEventsLink citySlugs={citySlugs} fallbackCity={citySlugs[0] ?? 'austin'} />
      </div>
    </div>
  )
}
