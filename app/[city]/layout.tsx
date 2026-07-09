import type { ReactNode } from 'react'
import { getEnabledCities } from '@/lib/db'
import { requireCity } from '@/lib/cities'

export async function generateStaticParams() {
  const cities = await getEnabledCities()
  return cities.map(c => ({ city: c.slug }))
}

export default async function CityLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  await requireCity(city) // 404s an unknown/disabled city slug
  return children
}
