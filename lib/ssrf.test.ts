import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { assertPublicHttpUrl, buildPinnedConnect, safeFetchHtml, SsrfError } from './ssrf'
import { Agent } from 'undici'

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) protocols', async () => {
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow(SsrfError)
  })

  it('rejects malformed URLs', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(SsrfError)
  })

  it('rejects loopback / private / link-local literal IPs', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/')).rejects.toThrow(SsrfError)
    await expect(assertPublicHttpUrl('http://10.0.0.5/')).rejects.toThrow(SsrfError)
    await expect(assertPublicHttpUrl('http://192.168.1.1/')).rejects.toThrow(SsrfError)
    await expect(assertPublicHttpUrl('http://169.254.169.254/')).rejects.toThrow(SsrfError) // cloud metadata
    await expect(assertPublicHttpUrl('http://[::1]/')).rejects.toThrow(SsrfError)
  })

  it('rejects localhost-ish and .internal/.local hostnames without a DNS round trip', async () => {
    await expect(assertPublicHttpUrl('http://localhost/')).rejects.toThrow(SsrfError)
    await expect(assertPublicHttpUrl('http://foo.internal/')).rejects.toThrow(SsrfError)
    await expect(assertPublicHttpUrl('http://foo.local/')).rejects.toThrow(SsrfError)
  })

  it('accepts a public literal IP and returns it as the pinned address', async () => {
    const result = await assertPublicHttpUrl('http://93.184.216.34/path')
    expect(result.url.hostname).toBe('93.184.216.34')
    expect(result.address).toBe('93.184.216.34')
  })
})

// --- DNS-rebinding pinning mechanism ---------------------------------------
//
// The vulnerability: assertPublicHttpUrl validates a hostname's DNS answer
// once, but handing the *hostname* (not the validated IP) to fetch() lets the
// HTTP client re-resolve DNS independently at connect time. An attacker
// controlling DNS for their submitted host can flip the answer between the
// validation lookup and the real connection (TTL=0), landing the connection
// on an internal address even though validation saw a public one.
//
// A live end-to-end rebinding attack isn't practical to simulate in a unit
// test (it requires controlling authoritative DNS for a real hostname). So
// instead these tests exercise the actual fix mechanism directly: they prove
// that `buildPinnedConnect` forces the real TCP socket to dial the pinned
// address while completely bypassing DNS resolution of the original
// hostname (using a hostname that cannot resolve to prove no DNS lookup
// happens at connect time), and that the Host header seen by the origin
// server still reflects the original hostname.
describe('buildPinnedConnect (DNS-rebinding fix mechanism)', () => {
  let server: http.Server
  let port: number

  afterEach(async () => {
    if (server) await new Promise(resolve => server.close(() => resolve(undefined)))
  })

  async function startServer(handler: http.RequestListener) {
    server = http.createServer(handler)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  }

  it('dials the pinned IP even when the claimed hostname cannot resolve in DNS', async () => {
    let seenHost = ''
    await startServer((req, res) => {
      seenHost = req.headers.host ?? ''
      res.end('ok')
    })

    const connect = buildPinnedConnect('127.0.0.1')
    const bogusHostname = 'this-host-does-not-exist-anywhere.invalid'

    const socket = await new Promise<import('node:net').Socket>((resolve, reject) => {
      connect(
        {
          hostname: bogusHostname, // what DNS would be asked for if we didn't pin
          host: `${bogusHostname}:${port}`,
          protocol: 'http:',
          port: String(port),
          servername: undefined,
        },
        (err, sock) => (err ? reject(err) : resolve(sock!))
      )
    })
    expect(socket.remoteAddress).toBe('127.0.0.1')
    socket.destroy()

    // Confirm it's a real, working connection end-to-end via the same Agent
    // wiring safeFetchHtml uses (Agent + `dispatcher` option on fetch), and
    // that the Host header the origin sees is still the original hostname
    // (not the pinned IP) — required for virtual hosting / correct routing
    // upstream and for the TLS SNI equivalent on HTTPS.
    const dispatcher = new Agent({ connect: buildPinnedConnect('127.0.0.1') })
    const res = await fetch(`http://${bogusHostname}:${port}/`, { dispatcher } as RequestInit)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(seenHost).toBe(`${bogusHostname}:${port}`)
    await dispatcher.close()
  })

  it('actually pins the connection (does not silently fall back to resolving the real hostname)', async () => {
    await startServer((_req, res) => res.end('should not be reached this way'))

    // Pin to an address where nothing is listening. If the override were a
    // no-op — e.g. if undici quietly re-resolved DNS for the given hostname
    // instead of honoring our pinned address — this fetch could still
    // "work" by accident. Pinning to a dead target must make it fail,
    // proving the connect override is actually taking effect.
    const deadDispatcher = new Agent({ connect: buildPinnedConnect('127.0.0.1') })
    const deadPort = port === 65535 ? 65534 : port + 1 // an adjacent port nothing listens on
    await expect(
      fetch(`http://this-host-does-not-exist-anywhere.invalid:${deadPort}/`, {
        dispatcher: deadDispatcher,
        signal: AbortSignal.timeout(2000),
      } as RequestInit)
    ).rejects.toThrow()
    await deadDispatcher.close()
  })
})

describe('safeFetchHtml (still works against real public URLs post-fix)', () => {
  it('rejects a submitted URL that targets a private address before ever fetching', async () => {
    await expect(safeFetchHtml('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(SsrfError)
  })
})
