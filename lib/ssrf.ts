import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { Agent, buildConnector } from 'undici'

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

// Result of validating a URL: the URL itself, plus the specific IP address
// that was checked and found to be public. Callers MUST connect to `address`
// rather than letting the HTTP client re-resolve `url.hostname` — see the
// DNS-rebinding note above `pinnedDispatcher` below.
export interface ValidatedUrl {
  url: URL
  address: string
}

// Parse `raw`, require http(s), and reject any host that is (or resolves to) a
// non-public address. Returns the validated URL together with the exact IP
// address that was validated, so the caller can pin the actual TCP connection
// to it (see `pinnedDispatcher`).
export async function assertPublicHttpUrl(raw: string): Promise<ValidatedUrl> {
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
    return { url: u, address: host }
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

  // Pin to the first validated address. All addresses in `records` were just
  // confirmed public above; which one we pick doesn't affect safety, only
  // which of the (already-safe) addresses we end up talking to.
  return { url: u, address: records[0].address }
}

// --- DNS-rebinding protection -----------------------------------------------
//
// Threat model: `assertPublicHttpUrl` resolves the submitted hostname via
// `dns.lookup` and validates the resolved address(es) are public. But if we
// then handed the *original URL* (hostname, not IP) to `fetch()`, the fetch
// implementation (undici) would perform its own, independent DNS resolution
// at connect time. An attacker who controls DNS for their submitted hostname
// can serve a public IP for our validation lookup, then — moments later, with
// TTL=0 — serve 169.254.169.254 (cloud metadata), 127.0.0.1, or an internal
// address for the connection undici actually makes. The validation and the
// connection would be resolving the same hostname at two different points in
// time against an adversarial, changing DNS answer: a classic TOCTOU / DNS
// rebinding bypass. This is reachable from the public, unauthenticated
// /api/submissions endpoint (via safeFetchHtml) as well as /api/import, so
// it's a real bypass, not a theoretical one.
//
// Fix: never let the HTTP client re-resolve the hostname. Instead, force the
// actual TCP (and, for HTTPS, TLS) connection to dial the exact IP address
// that was already validated as public, while still sending the original
// hostname as the Host header and TLS SNI/servername (required for the
// upstream to route the request correctly and for certificate validation to
// succeed against the real hostname). undici's `Agent` accepts a custom
// `connect` function; we wrap undici's default connector and override only
// the `hostname` field it uses to open the socket, leaving `servername`
// (which undici's Client already defaults to the request's Host) untouched.
// This mirrors undici's documented "Connector" customization pattern
// (see node_modules/undici/docs/docs/api/Connector.md) rather than
// reimplementing DNS pinning from scratch.
// Exported for testing: verifies the actual DNS-rebinding fix (the socket is
// forced to `pinnedAddress` regardless of what the original hostname would
// resolve to) without needing a live, adversarial DNS server in the test env.
export function buildPinnedConnect(pinnedAddress: string) {
  const connector = buildConnector({})
  return function connect(
    opts: Parameters<ReturnType<typeof buildConnector>>[0],
    callback: Parameters<ReturnType<typeof buildConnector>>[1]
  ) {
    // Only override the address the socket actually dials. `opts.servername`
    // (SNI/cert check) and the request's Host header are derived from the
    // original hostname elsewhere in undici and are untouched here.
    connector({ ...opts, hostname: pinnedAddress }, callback)
  }
}

// Build a one-shot dispatcher pinned to `address`. Pass this as `fetch`'s
// `dispatcher` option so the connection can never be re-resolved by DNS.
function pinnedDispatcher(address: string): Agent {
  return new Agent({ connect: buildPinnedConnect(address) })
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
    // Pin this hop's actual connection to the address `assertPublicHttpUrl`
    // just validated (see the DNS-rebinding note above `pinnedDispatcher`).
    // A fresh dispatcher per hop is required since a redirect can point at a
    // different host/address entirely.
    const dispatcher = pinnedDispatcher(current.address)
    let res: Response
    try {
      res = await fetch(current.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WhatItDo Events Bot/1.0; +https://whatitdo.app)',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
        dispatcher,
      } as RequestInit)
    } catch (e) {
      await dispatcher.close().catch(() => {})
      throw e
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new SsrfError('Redirect without a location')
      current = await assertPublicHttpUrl(new URL(location, current.url).toString())
      await dispatcher.close().catch(() => {})
      continue
    }

    if (!res.ok) {
      await dispatcher.close().catch(() => {})
      throw new SsrfError(`Upstream returned HTTP ${res.status}`)
    }

    try {
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
    } finally {
      await dispatcher.close().catch(() => {})
    }
  }

  throw new SsrfError('Too many redirects')
}
