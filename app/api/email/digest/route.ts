import { NextRequest, NextResponse } from 'next/server'
import { sendDigests, type DigestFrequency } from '@/lib/email/digest'
import { getEnabledCities } from '@/lib/db'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

function frequencyFrom(req: NextRequest): DigestFrequency {
  return req.nextUrl.searchParams.get('frequency') === 'weekly' ? 'weekly' : 'daily'
}

async function run(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const frequency = frequencyFrom(req)
  const cities = await getEnabledCities()
  const results = await Promise.all(cities.map(c => sendDigests(frequency, c.id)))
  const sent = results.reduce((n, r) => n + r.sent, 0)

  return NextResponse.json({ sent, frequency, byCity: results })
}

export async function POST(req: NextRequest) {
  return run(req)
}

// Vercel Cron invokes scheduled jobs with a GET request (carrying the
// CRON_SECRET bearer), so GET must be supported — it is guarded identically.
export async function GET(req: NextRequest) {
  return run(req)
}
