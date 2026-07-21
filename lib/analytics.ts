import { sendGAEvent } from '@next/third-parties/google'

// Single guarded entry point for Google Analytics 4 events. Mirrors the
// never-throws, best-effort philosophy of lib/track.ts: analytics must never
// break a user flow. No-ops entirely when GA isn't configured (no
// NEXT_PUBLIC_GA_ID), which keeps local dev and un-instrumented environments
// free of gtag "not initialized" warnings and network calls.

// NEXT_PUBLIC_* is inlined at build time, so this collapses to a constant.
const GA_ENABLED = Boolean(process.env.NEXT_PUBLIC_GA_ID)

type EventParams = Record<string, string | number | boolean | undefined>

export function trackEvent(name: string, params?: EventParams): void {
  if (!GA_ENABLED || typeof window === 'undefined') return
  try {
    sendGAEvent('event', name, params ?? {})
  } catch {
    // best-effort telemetry — never surface an error to the UI
  }
}
