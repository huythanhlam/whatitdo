-- lib/sources/partiful.ts read event.image.url out of Partiful's __NEXT_DATA__
-- payload, but that field points at a Firebase Storage object with no
-- download token — the URL 403s ("Permission Denied") rather than serving an
-- image (verified live 2026-07-13). Partiful's own frontend never renders
-- that URL either: it serves the same object through their imgix CDN at
-- image.upload.path. The parser now reads upload.path instead (see that
-- file), but events already ingested by the old code have the broken
-- firebasestorage URL sitting in `events.image_url` — repoint those to the
-- equivalent imgix URL so already-ingested Partiful events get working
-- pictures too, not just newly-ingested ones. The storage object path is the
-- URL-decoded segment between "/o/" and "?alt=media"; '/' is the only
-- character Firebase percent-encodes there (as %2F), so a plain replace
-- recovers it.
UPDATE events
SET image_url = 'https://partiful.imgix.net/' || replace(
  substring(image_url from '/o/(.*)\?alt=media$'),
  '%2F', '/'
)
WHERE image_url LIKE 'https://firebasestorage.googleapis.com/v0/b/getpartiful.appspot.com/o/%';
