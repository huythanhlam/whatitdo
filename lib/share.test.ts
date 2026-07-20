import { describe, it, expect } from 'vitest'
import { shareText, emailSubject, buildShareTargets } from './share'

const url = 'https://whatitdo.app/austin/events/abc-123'
const title = 'Bats & Brews: A Congress Ave Party'

describe('shareText', () => {
  it('is a first-person invite hook that names the event', () => {
    const text = shareText(title)
    expect(text).toContain(title)
    expect(text.toLowerCase()).toContain('with me')
  })
})

describe('emailSubject', () => {
  it('is a short invite that names the event', () => {
    expect(emailSubject(title)).toContain(title)
  })
})

describe('buildShareTargets', () => {
  const targets = buildShareTargets({ url, title })

  it('returns whatsapp, imessage, x, and email in order', () => {
    expect(targets.map(t => t.id)).toEqual(['whatsapp', 'imessage', 'x', 'email'])
  })

  it('encodes the url in every target so query strings survive', () => {
    for (const t of targets) {
      // The raw, unencoded URL must never appear verbatim in the href — that
      // would mean an unescaped param that could break the intent link.
      expect(t.href).not.toContain(url)
      expect(t.href).toContain(encodeURIComponent(url).slice(0, 20))
    }
  })

  it('carries both the caption and the link to WhatsApp', () => {
    const wa = targets.find(t => t.id === 'whatsapp')!
    expect(wa.href.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(wa.href)).toContain(shareText(title))
    expect(decodeURIComponent(wa.href)).toContain(url)
  })

  it('passes text and url as separate params to X', () => {
    const x = targets.find(t => t.id === 'x')!
    expect(x.href).toContain('https://twitter.com/intent/tweet?')
    expect(x.href).toContain(`text=${encodeURIComponent(shareText(title))}`)
    expect(x.href).toContain(`url=${encodeURIComponent(url)}`)
  })

  it('pre-fills the iMessage/SMS body with the hook and the link', () => {
    const im = targets.find(t => t.id === 'imessage')!
    expect(im.href.startsWith('sms:?&body=')).toBe(true)
    const decoded = decodeURIComponent(im.href)
    expect(decoded).toContain(shareText(title))
    expect(decoded).toContain(url)
  })

  it('no longer offers a Facebook target', () => {
    const ids = targets.map(t => String(t.id))
    expect(ids).not.toContain('facebook')
    expect(targets.map(t => t.label)).not.toContain('Facebook')
  })

  it('builds a mailto with a short subject and the hook + link in the body', () => {
    const email = targets.find(t => t.id === 'email')!
    expect(email.href.startsWith('mailto:?')).toBe(true)
    expect(email.href).toContain(`subject=${encodeURIComponent(emailSubject(title))}`)
    const decoded = decodeURIComponent(email.href)
    expect(decoded).toContain(shareText(title))
    expect(decoded).toContain(url)
  })
})
