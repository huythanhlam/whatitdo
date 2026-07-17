import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mutable test doubles the mocked createServiceClient hands back, so each test
// controls what the RPC returns and can assert whether the OTP was sent.
const rpc = vi.fn()
const signInWithOtp = vi.fn()

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc, auth: { signInWithOtp } }),
}))

import { POST } from './route'

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  rpc.mockReset()
  signInWithOtp.mockReset()
  signInWithOtp.mockResolvedValue({ error: null })
})

describe('POST /api/auth/magic-link', () => {
  it('sends an OTP only when the account opted in', async () => {
    rpc.mockResolvedValue({ data: true, error: null })

    const res = await POST(post({ email: 'yes@example.com', redirect: '/account' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('magic_link_allowed', { p_email: 'yes@example.com' })
    expect(signInWithOtp).toHaveBeenCalledTimes(1)
    const arg = signInWithOtp.mock.calls[0][0]
    expect(arg.email).toBe('yes@example.com')
    // Magic link may never create an account — sign-up is password-only.
    expect(arg.options.shouldCreateUser).toBe(false)
    // The internal redirect is carried into the callback's `next`.
    expect(arg.options.emailRedirectTo).toBe(
      'http://localhost:3000/auth/callback?next=%2Faccount'
    )
  })

  it('does NOT send when the account has not opted in', async () => {
    rpc.mockResolvedValue({ data: false, error: null })

    const res = await POST(post({ email: 'no@example.com' }))

    expect(signInWithOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns the identical neutral response whether or not opted in (no enumeration)', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
    const allowed = await POST(post({ email: 'yes@example.com' }))
    rpc.mockResolvedValueOnce({ data: false, error: null })
    const denied = await POST(post({ email: 'no@example.com' }))

    expect(allowed.status).toBe(denied.status)
    expect(await allowed.json()).toEqual(await denied.json())
  })

  it('never sends on an RPC error, and still responds neutrally', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const res = await POST(post({ email: 'x@example.com' }))

    expect(signInWithOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('skips a malformed email without calling the RPC', async () => {
    const res = await POST(post({ email: 'not-an-email' }))

    expect(rpc).not.toHaveBeenCalled()
    expect(signInWithOtp).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ ok: true })
  })

  it('drops an external redirect (only internal paths become `next`)', async () => {
    rpc.mockResolvedValue({ data: true, error: null })

    await POST(post({ email: 'yes@example.com', redirect: 'https://evil.example/phish' }))

    const arg = signInWithOtp.mock.calls[0][0]
    expect(arg.options.emailRedirectTo).toBe('http://localhost:3000/auth/callback')
  })
})
