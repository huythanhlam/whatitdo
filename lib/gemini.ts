import { GoogleGenAI } from '@google/genai'
import { AsyncLocalStorage } from 'node:async_hooks'

// The one and only Gemini client. Every model call in the app goes through
// geminiJson — fence-stripping, JSON parsing, retry-once-on-429, the RPM rate
// limiter, and the daily request budget live here and nowhere else. Callers pass
// a prompt (and optionally a responseSchema) and get back parsed JSON or null;
// null (missing key / budget exhausted / parse failure) is logged once and never
// thrown, so a source degrades to "no events" instead of crashing the run.

const apiKey = process.env.GEMINI_API_KEY
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

export const DEFAULT_MODEL = 'gemini-2.5-flash'
export const TAGGING_MODEL = 'gemini-2.5-flash-lite'

// True when a key is configured. Callers use it to skip work entirely (e.g. the
// keyword-tagger fallback) rather than issuing calls that would return null.
export function hasGemini(): boolean {
  return ai !== null
}

function intEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Free AI Studio tier is limited by request COUNT, not dollars (PRODUCT-SPEC
// §6.1): confirmed live at 5 req/min for gemini-2.5-flash (a 10 default here
// previously undercounted this and let bursts trip 429s) and a few hundred
// req/day. Defaults are chosen to stay inside the free tier; one env var each
// raises them for the paid tier.
const RPM = intEnv('GEMINI_RPM', 5)
const DAILY_BUDGET = intEnv('GEMINI_DAILY_BUDGET', 200)

// ---------------------------------------------------------------------------
// Per-run accounting. Sources run concurrently, so a plain global counter can't
// attribute requests to a source. An AsyncLocalStorage-scoped meter lets each
// source's fetch+tag work tally its own requests/budget-skips even while other
// sources run — the orchestrator records the tally in source_runs.
// ---------------------------------------------------------------------------
export type GeminiMeter = { requests: number; skippedForBudget: number }
const meterStore = new AsyncLocalStorage<GeminiMeter>()

// Run `fn` inside a fresh meter; returns fn's result plus that scope's counts.
export async function withGeminiMeter<T>(fn: () => Promise<T>): Promise<{ result: T; meter: GeminiMeter }> {
  const meter: GeminiMeter = { requests: 0, skippedForBudget: 0 }
  const result = await meterStore.run(meter, fn)
  return { result, meter }
}

// ---------------------------------------------------------------------------
// Global daily budget + RPM limiter (process-wide; the daily ingest cron is a
// single process, so an in-process counter caps it. Documented deviation: this
// is not persisted across serverless invocations — with the once-daily cron a
// second same-day run is the only gap, acceptable until a DB counter is needed.)
// ---------------------------------------------------------------------------
let dailyCount = 0
let dailyKey = ''
let recent: number[] = [] // request timestamps within the trailing 60s

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function budgetRemaining(): number {
  if (dailyKey !== today()) { dailyKey = today(); dailyCount = 0 }
  return DAILY_BUDGET - dailyCount
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Block until firing another request stays under RPM.
async function rateLimit(): Promise<void> {
  const now = Date.now()
  recent = recent.filter(t => now - t < 60_000)
  if (recent.length >= RPM) {
    const wait = 60_000 - (now - recent[0]) + 50
    await sleep(wait)
    return rateLimit()
  }
  recent.push(Date.now())
}

function isRateLimitError(e: unknown): boolean {
  const s = String((e as Error)?.message ?? e)
  return s.includes('429') || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(s)
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

let warnedNoKey = false

export async function geminiJson<T>(opts: {
  prompt: string
  schema?: object
  model?: string
  maxOutputTokens?: number
}): Promise<T | null> {
  if (!ai) {
    if (!warnedNoKey) { console.warn('GEMINI_API_KEY not set — Gemini features disabled'); warnedNoKey = true }
    return null
  }

  const meter = meterStore.getStore()
  if (budgetRemaining() <= 0) {
    if (meter) meter.skippedForBudget++
    return null
  }

  await rateLimit()
  dailyCount++
  if (meter) meter.requests++

  const call = () =>
    ai.models.generateContent({
      model: opts.model ?? DEFAULT_MODEL,
      contents: opts.prompt,
      config: {
        temperature: 0,
        maxOutputTokens: opts.maxOutputTokens ?? 4096,
        ...(opts.schema ? { responseMimeType: 'application/json', responseSchema: opts.schema } : {}),
      },
    })

  let response
  try {
    response = await call()
  } catch (e) {
    if (isRateLimitError(e)) {
      await sleep(2000)
      try {
        response = await call() // retry once
      } catch (e2) {
        console.error('Gemini request failed (after 429 retry):', (e2 as Error).message)
        return null
      }
    } else {
      console.error('Gemini request failed:', (e as Error).message)
      return null
    }
  }

  try {
    return JSON.parse(stripFences(response.text ?? '')) as T
  } catch {
    console.error('Gemini returned unparseable JSON')
    return null
  }
}

// Bounded-concurrency map — the one concurrency helper, replacing the four
// hand-rolled worker pools. Preserves input order in the output.
export async function mapPool<A, B>(items: A[], limit: number, fn: (a: A, i: number) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}
