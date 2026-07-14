import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveSslConfig } from './pg'

const REMOTE_URL = 'postgres://user:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres'

describe('resolveSslConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is off for a local connection regardless of env vars', () => {
    vi.stubEnv('DATABASE_SSL_INSECURE', '')
    vi.stubEnv('DATABASE_CA_CERT', 'irrelevant')
    expect(resolveSslConfig('postgres://user:pass@localhost:5432/postgres')).toBeUndefined()
    expect(resolveSslConfig('postgres://user:pass@127.0.0.1:5432/postgres')).toBeUndefined()
    expect(resolveSslConfig('postgres://user:pass@example.com:5432/postgres?sslmode=disable')).toBeUndefined()
  })

  it('defaults to verified TLS for a non-local connection', () => {
    vi.stubEnv('DATABASE_SSL_INSECURE', '')
    vi.stubEnv('DATABASE_CA_CERT', '')
    expect(resolveSslConfig(REMOTE_URL)).toEqual({ rejectUnauthorized: true })
  })

  it('disables verification only when DATABASE_SSL_INSECURE=true and no CA cert is pinned', () => {
    vi.stubEnv('DATABASE_SSL_INSECURE', 'true')
    vi.stubEnv('DATABASE_CA_CERT', '')
    expect(resolveSslConfig(REMOTE_URL)).toEqual({ rejectUnauthorized: false })
  })

  it('pins DATABASE_CA_CERT and keeps verification on', () => {
    vi.stubEnv('DATABASE_SSL_INSECURE', '')
    vi.stubEnv('DATABASE_CA_CERT', '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----')
    expect(resolveSslConfig(REMOTE_URL)).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    })
  })

  it('a pinned CA cert wins even if DATABASE_SSL_INSECURE=true is also set', () => {
    vi.stubEnv('DATABASE_SSL_INSECURE', 'true')
    vi.stubEnv('DATABASE_CA_CERT', '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----')
    expect(resolveSslConfig(REMOTE_URL)).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    })
  })

  it('normalizes literal \\n sequences in a pasted CA cert into real newlines', () => {
    vi.stubEnv('DATABASE_SSL_INSECURE', '')
    vi.stubEnv('DATABASE_CA_CERT', '-----BEGIN CERTIFICATE-----\\nMIIB...\\n-----END CERTIFICATE-----')
    const ssl = resolveSslConfig(REMOTE_URL) as { ca: string; rejectUnauthorized: boolean }
    expect(ssl.ca).toBe('-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----')
    expect(ssl.rejectUnauthorized).toBe(true)
  })
})
