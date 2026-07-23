-- Phase 2B: link the observability ledger and provenance to the sources table.
-- source_runs.source and event_sources.source (TEXT) were placeholders for this
-- FK (see migrations 006, 007). We ADD source_id and backfill by matching the
-- legacy text to sources.name — we keep the TEXT columns for human readability
-- and for rows whose source predates the sources table (source_id stays NULL).

ALTER TABLE source_runs   ADD COLUMN source_id INT REFERENCES sources(id);
ALTER TABLE event_sources ADD COLUMN source_id INT REFERENCES sources(id);

-- Backfill: every seeded sources.name equals the RawEvent.source string these
-- rows were written with, so this is an exact join.
UPDATE source_runs   sr SET source_id = s.id FROM sources s WHERE sr.source = s.name;
UPDATE event_sources es SET source_id = s.id FROM sources s WHERE es.source = s.name;

CREATE INDEX source_runs_source_id   ON source_runs(source_id);
CREATE INDEX event_sources_source_id ON event_sources(source_id);
