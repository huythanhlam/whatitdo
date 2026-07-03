import { lookup } from 'node:dns/promises'
import net from 'node:net'

// SSRF guards for user-supplied URLs (the /api/import endpoint fetches an
// arbitrary caller-provided URL). Without these, an attacker could point the
// server at internal services or the cloud metadata endpoint (169.254.169.254).

export class SsrfError extends Error {}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true // this-network, private, loopback
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a >= 224) return true // multicast / reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (addr === '::1' || addr === '::') return true
  if (addr.startsWith('fe80')) return true // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // unique-local
  const mapped = addr.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

function isPrivateAddr(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return isPrivateIPv4(ip)
  if (v === 6) return isPrivateIPv6(ip)
  return true // not a recognizable IP → treat as unsafe
}

// Parse `raw`, require http(s), and reject any host that is (or resolves to) a
// non-public address. Returns the validated URL.
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new SsrfError('Invalid URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError('Only http(s) URLs are allowed')
  }

  const host = u.hostname.replace(/^\[|\]$/g, '')

  if (net.isIP(host)) {
    if (isPrivateAddr(host)) throw new SsrfError('URL targets a non-public address')
    return u
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new SsrfError('URL targets a non-public address')
  }

  let records: { address: string }[]
  try {
    records = await lookup(host, { all: true })
  } catch {
    throw new SsrfError('Could not resolve host')
  }
  if (records.length === 0 || records.some(r => isPrivateAddr(r.address))) {
    throw new SsrfError('URL targets a non-public address')
  }

  return u
}

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 4

// Fetch HTML from a user-supplied URL with SSRF protection applied to every hop
// (redirects are followed manually so a public URL can't 302 to an internal
// one), a hard timeout, and a response-size cap. Returns the response body text.
export async function safeFetchHtml(startUrl: string): Promise<string> {
  let current = await assertPublicHttpUrl(startUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WhatItDo Events Bot/1.0; +https://whatitdo.app)',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new SsrfError('Redirect without a location')
      current = await assertPublicHttpUrl(new URL(location, current).toString())
      continue
    }

    if (!res.ok) throw new SsrfError(`Upstream returned HTTP ${res.status}`)

    const reader = res.body?.getReader()
    if (!reader) return ''
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel()
          throw new SsrfError('Response exceeds size limit')
        }
        chunks.push(value)
      }
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))))
  }

  throw new SsrfError('Too many redirects')
}
