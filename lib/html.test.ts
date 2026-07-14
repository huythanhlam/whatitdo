import { describe, it, expect } from 'vitest'
import { escapeHtml, safeUrl, httpOrNull } from './html'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert('x')&"y"</script>`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&amp;&quot;y&quot;&lt;/script&gt;'
    )
  })

  it('coerces null/undefined to an empty string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('safeUrl', () => {
  it('passes through and escapes a well-formed http(s) URL', () => {
    expect(safeUrl('https://example.com/a?b=1&c=2')).toBe('https://example.com/a?b=1&amp;c=2')
  })

  it('rejects non-http(s) schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('')
  })
})

describe('httpOrNull', () => {
  it('returns well-formed http(s) URLs unchanged', () => {
    expect(httpOrNull('https://example.com/tickets')).toBe('https://example.com/tickets')
    expect(httpOrNull('http://example.com')).toBe('http://example.com')
  })

  it('rejects javascript:/data:/vbscript: and other non-http(s) schemes', () => {
    expect(httpOrNull('javascript:alert(document.cookie)')).toBeNull()
    expect(httpOrNull('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(httpOrNull('vbscript:msgbox(1)')).toBeNull()
    expect(httpOrNull('file:///etc/passwd')).toBeNull()
  })

  it('rejects unparseable and empty input', () => {
    expect(httpOrNull('not a url')).toBeNull()
    expect(httpOrNull(null)).toBeNull()
    expect(httpOrNull(undefined)).toBeNull()
    expect(httpOrNull('')).toBeNull()
  })
})
