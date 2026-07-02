-- Phase PROG-01: progress graph metadata fields.
-- Adds storage for BMS measure note analysis, progress paint maps,
-- progress graph image metadata, and completion-collapse display state.

ALTER TABLE versions ADD COLUMN play_notes INTEGER CHECK (play_notes IS NULL OR play_notes >= 0);
ALTER TABLE versions ADD COLUMN first_note_measure INTEGER CHECK (first_note_measure IS NULL OR first_note_measure >= 0);
ALTER TABLE versions ADD COLUMN last_note_measure INTEGER CHECK (last_note_measure IS NULL OR last_note_measure >= 0);
ALTER TABLE versions ADD COLUMN target_measure_count INTEGER CHECK (target_measure_count IS NULL OR target_measure_count >= 0);
ALTER TABLE versions ADD COLUMN measure_notes_json TEXT;
ALTER TABLE versions ADD COLUMN progress_map_json TEXT;

ALTER TABLE versions ADD COLUMN progress_image_key TEXT;
ALTER TABLE versions ADD COLUMN progress_image_mime TEXT;
ALTER TABLE versions ADD COLUMN progress_image_size INTEGER CHECK (progress_image_size IS NULL OR progress_image_size >= 0);
ALTER TABLE versions ADD COLUMN progress_image_sha256 TEXT;
ALTER TABLE versions ADD COLUMN progress_image_created_at TEXT;

ALTER TABLE versions ADD COLUMN collapsed_by_completion INTEGER NOT NULL DEFAULT 0 CHECK (collapsed_by_completion IN (0, 1));
ALTER TABLE versions ADD COLUMN collapsed_reason TEXT CHECK (
  collapsed_reason IS NULL OR collapsed_reason IN ('superseded_by_completed_descendant')
);
ALTER TABLE versions ADD COLUMN collapsed_at TEXT;
ALTER TABLE versions ADD COLUMN collapsed_by_version_id TEXT;

CREATE INDEX IF NOT EXISTS idx_versions_measure_range
  ON versions (first_note_measure, last_note_measure);

CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_progress_image_key
  ON versions (progress_image_key);

CREATE INDEX IF NOT EXISTS idx_versions_collapsed_completion
  ON versions (chart_id, collapsed_by_completion, branch_path);

CREATE INDEX IF NOT EXISTS idx_versions_collapsed_by_version
  ON versions (collapsed_by_version_id);
