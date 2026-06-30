'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { WHEN_PRESETS } from '@/lib/dateRanges'
import { Calendar, X } from 'lucide-react'

export function DateFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const when = searchParams.get('when')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const customActive = !!(from || to)

  const [showCustom, setShowCustom] = useState(customActive)
  const [fromVal, setFromVal] = useState(from ?? '')
  const [toVal, setToVal] = useState(to ?? '')

  function setPreset(value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('from')
    params.delete('to')
    params.delete('page')
    if (value && when !== value) params.set('when', value)
    else params.delete('when')
    setShowCustom(false)
    router.push(`/?${params.toString()}`)
  }

  function applyCustom() {
    if (!fromVal && !toVal) return
    const params = new URLSearchParams(searchParams.toString())
    params.delete('when')
    params.delete('page')
    if (fromVal) params.set('from', fromVal); else params.delete('from')
    if (toVal) params.set('to', toVal); else params.delete('to')
    router.push(`/?${params.toString()}`)
  }

  function clearCustom() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('from')
    params.delete('to')
    params.delete('page')
    setFromVal(''); setToVal(''); setShowCustom(false)
    router.push(`/?${params.toString()}`)
  }

  const pill = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap border ${
      active
        ? 'bg-violet-600 text-white border-violet-600'
        : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
    }`

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button onClick={() => setPreset(null)} className={pill(!when && !customActive)}>
          All Upcoming
        </button>
        {WHEN_PRESETS.map(p => (
          <button key={p.value} onClick={() => setPreset(p.value)} className={pill(when === p.value)}>
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(s => !s)}
          className={`${pill(customActive)} flex items-center gap-1.5`}
        >
          <Calendar className="w-3.5 h-3.5" />
          {customActive ? `${from ?? '…'} – ${to ?? '…'}` : 'Custom'}
        </button>
        {customActive && (
          <button onClick={clearCustom} className="text-slate-400 hover:text-slate-700 shrink-0" aria-label="Clear date range">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showCustom && (
        <div className="mt-3 flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500" htmlFor="date-from">From</label>
            <input
              id="date-from" type="date" value={fromVal}
              onChange={e => setFromVal(e.target.value)}
              className="border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500" htmlFor="date-to">To</label>
            <input
              id="date-to" type="date" value={toVal} min={fromVal || undefined}
              onChange={e => setToVal(e.target.value)}
              className="border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={applyCustom}
            disabled={!fromVal && !toVal}
            className="bg-violet-600 text-white text-sm font-medium px-4 py-1.5 rounded-md hover:bg-violet-700 disabled:opacity-40 transition-colors"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
