// Pure builders for event share links. Kept free of React and side effects so
// the URL construction is unit-testable; the ShareButton client island owns the
// interactive bits (native share sheet, clipboard, tracking).

export type ShareTarget = {
  id: 'whatsapp' | 'imessage' | 'x' | 'email'
  label: string
  href: string
}

// The pre-loaded, personal invite that rides along with the link on every
// platform that accepts free text (WhatsApp, X, email body, the native sheet).
// Written as a first-person "come with me" hook — it reads like a friend
// forwarding a plan, which shares far better than a bare "Check out …".
export function shareText(title: string): string {
  return `Hey! I thought you might want to go to ${title} with me 🎉`
}

// A short, catchy email subject line — the invite hook itself is too long to sit
// well in a subject, so the subject teases and the body carries the full hook.
export function emailSubject(title: string): string {
  return `Let's go to ${title}?`
}

// Web share-intent URLs for the platforms that actually expose one. Instagram,
// TikTok, and Messenger have no such scheme — those go through the native share
// sheet in the component, not here.
export function buildShareTargets({ url, title }: { url: string; title: string }): ShareTarget[] {
  const text = shareText(title)
  const encUrl = encodeURIComponent(url)
  const encText = encodeURIComponent(text)
  // WhatsApp takes a single `text` field; put the caption and the link together.
  const encTextWithUrl = encodeURIComponent(`${text} ${url}`)

  return [
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encTextWithUrl}`,
    },
    {
      // The `sms:` scheme opens Messages (iMessage on Apple devices, SMS on
      // Android). `?&body=` is the cross-platform form that reliably pre-fills
      // the message on iOS 8+ and Android — so iMessage carries the full hook.
      id: 'imessage',
      label: 'Text Message',
      href: `sms:?&body=${encTextWithUrl}`,
    },
    {
      id: 'x',
      label: 'X',
      href: `https://twitter.com/intent/tweet?text=${encText}&url=${encUrl}`,
    },
    {
      id: 'email',
      label: 'Email',
      href: `mailto:?subject=${encodeURIComponent(emailSubject(title))}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
    },
  ]
}
