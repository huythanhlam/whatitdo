import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InputError, resolvePage, extractAndPersist } from './submissions'
import { SsrfError } from '@/lib/ssrf'

vi.mock('@/lib/ssrf', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ssrf')>('@/lib/ssrf')
  return {
    ...actual,
    safeFetchHtml: vi.fn(),
  }
})

vi.mock('@/lib/extractor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/extractor')>('@/lib/extractor')
  return {
    ...actual,
    extractEventsFromPages: vi.fn(),
  }
})

import { safeFetchHtml } from '@/lib/ssrf'
import { extractEventsFromPages } from '@/lib/extractor'

describe('InputError', () => {
  it('is an Error subclass carrying message + status', () => {
    const e = new InputError('bad input', 400)
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(InputError)
    expect(e.message).toBe('bad input')
    expect(e.status).toBe(400)
  })
})

describe('resolvePage — text-only path', () => {
  it('returns a text-sourced page with the default "import" source when no override is given', async () => {
    const page = await resolvePage('', 'some pasted text', undefined)
    expect(page).toEqual({ source: 'import', url: '', title: null, image_url: null, text: 'some pasted text' })
  })

  it('applies sourceOverride when given', async () => {
    const page = await resolvePage('', 'some pasted text', 'submission')
    expect(page).toEqual({ source: 'submission', url: '', title: null, image_url: null, text: 'some pasted text' })
  })
})

describe('resolvePage — neither url nor text', () => {
  it('throws InputError 400 with the exact message', async () => {
    await expect(resolvePage('', '', undefined)).rejects.toMatchObject({
      message: 'Provide a "url" or "text" field',
      status: 400,
    })
    await expect(resolvePage('', '', undefined)).rejects.toBeInstanceOf(InputError)
  })
})

describe('resolvePage — url path (safeFetchHtml mocked)', () => {
  beforeEach(() => {
    vi.mocked(safeFetchHtml).mockReset()
  })

  it('resolves a successful fetch into a page, applying sourceOverride when given', async () => {
    const longText = 'A'.repeat(50)
    vi.mocked(safeFetchHtml).mockResolvedValue(
      `<html><head><title>My Page</title></head><body><main>${longText}</main></body></html>`
    )
    const page = await resolvePage('https://example.com/post', '', 'submission')
    expect(page.source).toBe('submission')
    expect(page.title).toBe('My Page')
    expect(page.text.length).toBeGreaterThanOrEqual(40)
  })

  it('rejects with a 422 InputError when the resolved page text is too short', async () => {
    vi.mocked(safeFetchHtml).mockResolvedValue('<html><body><main>short</main></body></html>')
    await expect(resolvePage('https://example.com/post', '', undefined)).rejects.toMatchObject({
      status: 422,
    })
  })

  it('wraps an SsrfError as a 400 InputError', async () => {
    vi.mocked(safeFetchHtml).mockRejectedValue(new SsrfError('URL targets a non-public address'))
    await expect(resolvePage('http://169.254.169.254/', '', undefined)).rejects.toMatchObject({
      status: 400,
    })
  })
})

describe('extractAndPersist', () => {
  beforeEach(() => {
    vi.mocked(extractEventsFromPages).mockReset()
  })

  it('returns the empty-result shape when extractEventsFromPages finds nothing', async () => {
    vi.mocked(extractEventsFromPages).mockResolvedValue([])
    const page = { source: 'import', url: '', title: null, image_url: null, text: 'nothing here' }
    const result = await extractAndPersist(page, { cityId: 1, status: 'approved' })
    expect(result).toEqual({ inserted: 0, skipped: 0, total: 0, events: [] })
  })
})
