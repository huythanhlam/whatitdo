'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { sourceLabel } from '@/lib/sourceLabels'

export function SourceFilter({ sources, compact = false }: { sources: string[]; compact?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selected = searchParams.getAll('source')

  function toggle(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    const existing = params.getAll('source')
    params.delete('source')
    if (existing.includes(value)) {
      existing.filter(s => s !== value).forEach(s => params.append('source', s))
    } else {
      [...existing, value].forEach(s => params.append('source', s))
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('source')
    router.push(`${pathname}?${params.toString()}`)
  }

  if (sources.length === 0) return null

  if (compact) {
    // Horizontal scrollable chips for mobile, where the sidebar is hidden.
    return (
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {sources.map(src => {
          const on = selected.includes(src)
          return (
            <button
              key={src}
              onClick={() => toggle(src)}
              className={`px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${
                on
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'bg-background text-muted-foreground border-border'
              }`}
            >
              {sourceLabel(src)}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <aside className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Source</h2>
        {selected.length > 0 && (
          <button onClick={clearAll} className="text-sm text-primary hover:underline py-1">
            Clear
          </button>
        )}
      </div>
      <Separator />
      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
        {sources.map(src => (
          <div key={src} className="flex items-center gap-2.5 py-1.5">
            <Checkbox
              id={`source-${src}`}
              checked={selected.includes(src)}
              onCheckedChange={() => toggle(src)}
            />
            <Label htmlFor={`source-${src}`} className="cursor-pointer text-sm font-normal">
              {sourceLabel(src)}
            </Label>
          </div>
        ))}
      </div>
    </aside>
  )
}
