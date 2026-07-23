-- supabase/migrations/013_event_status.sql
-- Phase 2: public submissions land as 'pending' until an admin approves them;
-- every pipeline-ingested event (cron ingest + on-demand /api/import) is
-- auto-approved. Rejected rows are kept, not deleted, for provenance/dedup
-- history, and simply excluded from every public read path.
ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE events ADD CONSTRAINT events_status_check CHECK (status IN ('approved', 'pending', 'rejected'));
CREATE INDEX events_status_pending ON events (city_id, status) WHERE status <> 'approved';
