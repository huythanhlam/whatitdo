import { NextRequest, NextResponse } from 'next/server'
import { sendDailyDigests } from '@/lib/email/digest'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendDailyDigests()
  return NextResponse.json(result)
}
