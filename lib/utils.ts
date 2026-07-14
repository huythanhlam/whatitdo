import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Category accent colors span the whole palette (dark slate to bright amber),
// so a badge painted with one at full opacity needs its text color picked per
// swatch — a hardcoded white reads fine on slate but is nearly invisible on
// amber. YIQ luminance is a cheap, well-established heuristic for this exact
// "what text color reads on this background" problem.
export function readableTextColor(hex: string, dark = '#1C2929', light = '#FFFFFF'): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 128 ? dark : light
}
