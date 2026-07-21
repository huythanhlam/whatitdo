'use client'
import { useReportWebVitals } from 'next/web-vitals'
import { trackEvent } from '@/lib/analytics'

// Forwards Core Web Vitals (LCP, CLS, INP, FCP, TTFB) into GA4 as events so
// field performance lives next to traffic and conversions in one property.
// useReportWebVitals fires the callback once per metric as it becomes available
// during the page's lifecycle. Renders nothing — mounted once in the layout.
export function WebVitals() {
  useReportWebVitals(metric => {
    trackEvent(metric.name, {
      // GA4 event values must be integers. CLS is a small unitless float, so
      // scale it up (the GA4 web-vitals convention) to keep precision.
      value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
      metric_id: metric.id,
      metric_rating: metric.rating,
      non_interaction: true,
    })
  })
  return null
}
