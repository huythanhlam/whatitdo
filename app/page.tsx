import { permanentRedirect } from 'next/navigation'
import { getEnabledCities } from '@/lib/db'

export default async function RootPage() {
  const cities = await getEnabledCities()
  const first = cities[0]?.slug ?? 'austin'
  permanentRedirect(`/${first}`)
}
