import { NextRequest, NextResponse } from 'next/server'
import { sendDigests, type DigestFrequency } from '@/lib/email/digest'
import { requireCronAuth } from '@/lib/auth'

export const maxDuration = 300

function frequencyFrom(req: NextRequest): DigestFrequency {
  return req.nextUrl.searchParams.get('frequency') === 'weekly' ? 'weekly' : 'daily'
}

async function run(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  const result = await sendDigests(frequencyFrom(req))
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  return run(req)
}

// Vercel Cron invokes scheduled jobs with a GET request (carrying the
// CRON_SECRET bearer), so GET must be supported — it is guarded identically.
export async function GET(req: NextRequest) {
  return run(req)
}
