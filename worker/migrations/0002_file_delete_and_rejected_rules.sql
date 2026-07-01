-- Phase 10-F: prepare file deletion lifecycle and rejected-chart rules.
-- 0001_initial.sql is already applied, so this migration only adds new columns.

ALTER TABLE versions ADD COLUMN file_deleted_at TEXT;
ALTER TABLE versions ADD COLUMN file_delete_reason TEXT;
