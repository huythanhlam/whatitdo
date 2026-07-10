'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition, useRef } from 'react'
import { Input } from '@/components/ui/input'

export function SearchBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set('q', value)
      } else {
        params.delete('q')
      }
      params.delete('page')
      startTransition(() => router.push(`${pathname}?${params.toString()}`))
    }, 300)
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">🔍</span>
      <Input
        defaultValue={searchParams.get('q') ?? ''}
        onChange={handleChange}
        placeholder="Search events, venues…"
        className="pl-8"
      />
      {isPending && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}
