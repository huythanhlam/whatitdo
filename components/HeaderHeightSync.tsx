'use client'
import { useEffect } from 'react'

// The header's rendered height isn't a fixed constant — it wraps to more rows
// on narrow screens and shifts slightly with font metrics/content, so the
// sticky sidebar and mobile filter bar read this CSS var instead of a
// hardcoded offset that drifts out of sync with the real layout.
export function HeaderHeightSync() {
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return

    const sync = () => {
      document.documentElement.style.setProperty('--header-h', `${header.getBoundingClientRect().height}px`)
    }
    sync()

    const observer = new ResizeObserver(sync)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  return null
}
