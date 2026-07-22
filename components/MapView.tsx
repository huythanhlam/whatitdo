'use client'
import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { getTicketProvider } from '@/lib/tickets'
import { escapeHtml, safeUrl } from '@/lib/html'
import type { EnrichedEvent } from '@/lib/types'

type Props = {
  events: EnrichedEvent[]
  center: { lat: number; lng: number }
  basePath: string
}

function infoWindowContent(event: EnrichedEvent, basePath: string): string {
  const date = new Date(event.start_time)
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const provider = getTicketProvider(event.ticket_url)
  const ticketUrl = safeUrl(event.ticket_url)
  const ticketLink = provider && ticketUrl
    ? `<a href="${ticketUrl}" target="_blank" rel="noopener noreferrer" style="color:#F17A7E;font-weight:600;">${escapeHtml(provider.cta)} →</a>`
    : ''

  // Rendered via InfoWindow's `content` (raw HTML string, Google Maps' own
  // API), not React — every field here (title, venue_name, ticket_url) comes
  // from scraped/third-party sources (lib/sources/*.ts), so all of it is
  // escaped exactly like lib/email/digest.ts escapes the same fields for the
  // HTML email digest.
  return `
    <div style="max-width:220px;font-family:inherit;">
      <a href="${basePath}/events/${event.id}" style="font-weight:600;color:#4A6163;text-decoration:none;">${escapeHtml(event.title)}</a>
      <p style="margin:4px 0 0;font-size:12px;color:#7C9092;">${dateStr} · ${timeStr}</p>
      ${event.venue_name ? `<p style="margin:2px 0 0;font-size:12px;color:#7C9092;">${escapeHtml(event.venue_name)}</p>` : ''}
      ${ticketLink ? `<p style="margin:6px 0 0;font-size:12px;">${ticketLink}</p>` : ''}
    </div>
  `
}

export function MapView({ events, center, basePath }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  // Long-lived across renders — the Map instance is created ONCE (so panning/
  // zooming survives a filter change) and only the marker set is rebuilt when
  // `events` changes. Refs, not state, since none of this should trigger a re-render.
  const mapObjRef = useRef<google.maps.Map | null>(null)
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const markerClassRef = useRef<typeof google.maps.Marker | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const [mapReady, setMapReady] = useState(false)

  // Effect 1: create the Map + InfoWindow once per apiKey (i.e. once, ever, in
  // practice). `center` is intentionally only used for the initial viewport —
  // it's not a dependency, so re-centering never resets a user's pan/zoom.
  useEffect(() => {
    if (!apiKey || !mapRef.current) return
    let cancelled = false

    setOptions({ key: apiKey, v: 'weekly' })
    // Legacy google.maps.Marker (not AdvancedMarkerElement) so no separate Map
    // ID needs configuring in Cloud Console for a first cut.
    Promise.all([importLibrary('maps'), importLibrary('marker')]).then(([{ Map, InfoWindow }, { Marker }]) => {
      if (cancelled || !mapRef.current) return
      mapObjRef.current = new Map(mapRef.current, { center, zoom: 12 })
      infoWindowRef.current = new InfoWindow()
      markerClassRef.current = Marker
      setMapReady(true)
    })

    return () => {
      cancelled = true
      clustererRef.current?.setMap(null)
      markersRef.current.forEach(m => m.setMap(null))
      markersRef.current = []
      mapObjRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center is intentionally initial-only, see comment above
  }, [apiKey])

  // Effect 2: rebuild just the marker set (not the whole map) whenever the
  // filtered event list changes — clearing the previous markers/clusterer
  // first so filter changes never leak or stack duplicate overlays.
  useEffect(() => {
    const map = mapObjRef.current
    const Marker = markerClassRef.current
    const infoWindow = infoWindowRef.current
    if (!mapReady || !map || !Marker || !infoWindow) return

    clustererRef.current?.setMap(null)
    markersRef.current.forEach(m => m.setMap(null))

    const markers = events
      .filter(e => e.lat != null && e.lng != null)
      .map(event => {
        const marker = new Marker({
          position: { lat: Number(event.lat), lng: Number(event.lng) },
          title: event.title,
        })
        marker.addListener('click', () => {
          infoWindow.setContent(infoWindowContent(event, basePath))
          infoWindow.open({ map, anchor: marker })
        })
        return marker
      })

    markersRef.current = markers
    clustererRef.current = new MarkerClusterer({ map, markers })
  }, [mapReady, events, basePath])

  if (!apiKey) {
    return (
      <div className="h-[600px] flex items-center justify-center text-sm text-muted-foreground bg-muted rounded-lg border">
        Map view is not configured for this deployment.
      </div>
    )
  }

  return <div ref={mapRef} className="h-[600px] w-full rounded-lg border" />
}
