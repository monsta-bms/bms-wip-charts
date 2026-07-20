-- WITHDRAWAL-LIFECYCLE-16A: reversible withdrawal request state.
-- version_id and chart_id intentionally have no foreign keys so that the
-- lifecycle audit row can survive a future physical version deletion.

CREATE TABLE version_withdrawals (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  chart_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'processing', 'canceled', 'deleted', 'tombstoned')
  ),
  request_mode TEXT NOT NULL CHECK (request_mode IN ('immediate', 'deferred')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_at TEXT NOT NULL,
  processing_at TEXT,
  canceled_at TEXT,
  resolved_at TEXT,
  processing_mode TEXT CHECK (
    processing_mode IS NULL OR processing_mode IN ('delete', 'tombstone')
  ),
  lease_token TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  idempotency_key_hash TEXT NOT NULL UNIQUE,
  requester_ip_hash TEXT NOT NULL,
  requester_ua_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (scheduled_at >= requested_at)
);

CREATE INDEX idx_version_withdrawals_status_schedule
  ON version_withdrawals (status, scheduled_at, id);

CREATE INDEX idx_version_withdrawals_version_requested
  ON version_withdrawals (version_id, requested_at DESC);

CREATE UNIQUE INDEX idx_version_withdrawals_active_version
  ON version_withdrawals (version_id)
  WHERE status IN ('pending', 'processing');
