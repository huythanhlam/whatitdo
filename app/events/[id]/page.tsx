import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getEvent as fetchEvent } from '@/lib/db'
import type { Event, Category } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

async function getEvent(id: string): Promise<(Event & { categories?: Category[] }) | null> {
  try {
    return (await fetchEvent(id)) as unknown as (Event & { categories?: Category[] }) | null
  } catch {
    return null
  }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await getEvent(id)

  if (!event) notFound()

  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const priceLabel = event.is_free ? 'Free' : event.price_min ? `From $${event.price_min}` : 'See tickets for pricing'

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <a href="/" className="text-sm text-violet-600 hover:underline">← Back to events</a>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {event.image_url && (
          <img
            src={event.image_url}
            alt={event.title}
            className="w-full h-64 object-cover rounded-xl mb-6 shadow-sm"
          />
        )}

        <div className="flex flex-wrap gap-1 mb-3">
          {event.categories?.map(cat => (
            <Badge
              key={cat.slug}
              style={{ backgroundColor: cat.color + '18', color: cat.color, borderColor: cat.color + '44' }}
              className="border text-xs"
            >
              {cat.name}
            </Badge>
          ))}
        </div>

        <h1 className="text-2xl font-bold mb-4 text-slate-900">{event.title}</h1>

        <div className="space-y-2 mb-6 text-sm text-slate-600">
          <p>📅 {dateStr} at {timeStr}</p>
          {event.venue_name && (
            <p>📍 {event.venue_name}{event.venue_address ? ` · ${event.venue_address}` : ''}</p>
          )}
          <p>{event.is_free ? '🆓 Free entry' : `💰 ${priceLabel}`}</p>
          <p className="text-xs text-slate-400">Source: {event.source}</p>
        </div>

        {event.description && (
          <p className="text-sm leading-relaxed mb-6 text-slate-700 whitespace-pre-line">
            {event.description}
          </p>
        )}

        <div className="flex gap-3 flex-wrap">
          {event.ticket_url && (
            <Button asChild className="bg-violet-600 hover:bg-violet-700">
              <a href={event.ticket_url} target="_blank" rel="noopener noreferrer">
                Get Tickets →
              </a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href="/subscribe">🔔 Get event alerts</a>
          </Button>
        </div>
      </div>
    </div>
  )
}
