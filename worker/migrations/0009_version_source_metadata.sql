-- DIFFICULTY-TABLE-VIEW Phase A: preserve metadata parsed from each uploaded BMS.

CREATE TABLE version_source_metadata (
  version_id TEXT PRIMARY KEY,

  source_title TEXT
    CHECK (source_title IS NULL OR length(source_title) <= 4096),

  source_subtitle TEXT
    CHECK (source_subtitle IS NULL OR length(source_subtitle) <= 4096),

  source_artist TEXT
    CHECK (source_artist IS NULL OR length(source_artist) <= 4096),

  source_subartist TEXT
    CHECK (source_subartist IS NULL OR length(source_subartist) <= 4096),

  encoding TEXT
    CHECK (encoding IS NULL OR length(encoding) <= 64),

  status TEXT NOT NULL
    CHECK (status IN ('succeeded', 'failed', 'unavailable')),

  error_code TEXT
    CHECK (error_code IS NULL OR length(error_code) <= 128),

  analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (version_id)
    REFERENCES versions(id)
    ON DELETE CASCADE,

  CHECK (
    (status = 'succeeded' AND error_code IS NULL)
    OR
    (status IN ('failed', 'unavailable') AND error_code IS NOT NULL)
  )
);

CREATE INDEX idx_version_source_metadata_status_updated
  ON version_source_metadata (status, updated_at, version_id);
