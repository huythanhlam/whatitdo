import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// A pure-CSS hover/focus tooltip — no client JS, so it works inside server
// components. The tip reveals on group-hover and group-focus-within (the wrapper
// is focusable via tabIndex, so keyboard and touch users can surface it too) and
// renders above the trigger, themed with the app's popover tokens.
export function Tooltip({
  children,
  content,
  className,
}: {
  children: ReactNode
  content: ReactNode
  className?: string
}) {
  return (
    <div
      tabIndex={0}
      className={cn(
        'group relative flex flex-col items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[14rem] -translate-x-1/2
                   scale-95 opacity-0 transition duration-150
                   group-hover:scale-100 group-hover:opacity-100
                   group-focus-within:scale-100 group-focus-within:opacity-100"
      >
        <div className="rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
          {content}
        </div>
        <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-border bg-popover" />
      </div>
    </div>
  )
}
