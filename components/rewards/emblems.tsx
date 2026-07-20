import { BADGE_ART_SVG } from '@/lib/rewards/art'

// Renders a badge's illustrated scene (from lib/rewards/art) as a full-bleed
// 64x64 SVG. The art carries its own colors; the MedalFrame clips it to a disc
// and adds the tier ring. Using the shared string source keeps the app and any
// static preview pixel-identical.
export function Emblem({ art, className }: { art: string; className?: string }) {
  const markup = BADGE_ART_SVG[art] ?? BADGE_ART_SVG.medal
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
