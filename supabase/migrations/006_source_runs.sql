-- Health ledger: one row per source per ingest run. Fixes "a dead source looks
-- like an empty source" — every source records how it went, so a source that
-- has silently produced nothing for days is visible in /api/admin/health.
CREATE TABLE source_runs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL,                    -- becomes source_id FK in Phase 2
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',  -- running | ok | error | skipped
  events_found    INT DEFAULT 0,
  events_upserted INT DEFAULT 0,
  events_rejected INT DEFAULT 0,
  gemini_requests INT DEFAULT 0,                    -- cost accounting (PRODUCT-SPEC §6)
  error           TEXT
);

-- The health view reads the most recent runs per source.
CREATE INDEX source_runs_source_started ON source_runs(source, started_at DESC);

ALTER TABLE source_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages source_runs" ON source_runs FOR ALL USING (auth.role() = 'service_role');
