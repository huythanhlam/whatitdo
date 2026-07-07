-- Phase 2C: moderation status for user submissions. Every existing row and every
-- ingest insert defaults to 'approved' (visible), so nothing changes for the
-- pipeline; only the public /api/submit path writes 'pending'. Public reads
-- filter to 'approved' (see lib/db/index.ts), so pending submissions are invisible
-- until an admin approves them.
ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- Moderation queue reads pending rows; public reads filter approved. Both benefit.
CREATE INDEX events_status ON events(status);
