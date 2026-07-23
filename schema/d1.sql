-- Canonical D1 schema for BMS WIP Charts.
-- This file mirrors the completed structure produced by worker/migrations for
-- new database setup and Dashboard SQL inspection. Existing databases must use migrations.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL,
  subartist TEXT NOT NULL DEFAULT '',
  normalized_title TEXT NOT NULL,
  normalized_subtitle TEXT NOT NULL DEFAULT '',
  normalized_artist TEXT NOT NULL,
  normalized_subartist TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (normalized_title, normalized_subtitle, normalized_artist, normalized_subartist)
);

CREATE TABLE IF NOT EXISTS charts (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  chart_name TEXT NOT NULL,
  normalized_chart_name TEXT NOT NULL,
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  hidden_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE RESTRICT,
  UNIQUE (song_id, normalized_chart_name)
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  chart_id TEXT NOT NULL,
  parent_version_id TEXT,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  branch_label TEXT NOT NULL DEFAULT '',
  branch_path TEXT NOT NULL,
  author TEXT NOT NULL,
  authors_json TEXT,
  progress INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  play_notes INTEGER CHECK (play_notes IS NULL OR play_notes >= 0),
  first_note_measure INTEGER CHECK (first_note_measure IS NULL OR first_note_measure >= 0),
  last_note_measure INTEGER CHECK (last_note_measure IS NULL OR last_note_measure >= 0),
  target_measure_count INTEGER CHECK (target_measure_count IS NULL OR target_measure_count >= 0),
  measure_notes_json TEXT,
  progress_map_json TEXT,
  comment TEXT NOT NULL DEFAULT '',
  difficulty TEXT,
  level TEXT,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL,
  subartist TEXT NOT NULL DEFAULT '',
  md5 TEXT,
  origin_url TEXT CHECK (
    origin_url IS NULL OR
    length(origin_url) BETWEEN 1 AND 2048
  ),
  is_rejected INTEGER NOT NULL DEFAULT 0 CHECK (is_rejected IN (0, 1)),
  allow_append INTEGER NOT NULL DEFAULT 1 CHECK (allow_append IN (0, 1)),
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  file_sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  file_deleted_at TEXT,
  file_delete_reason TEXT,
  progress_image_key TEXT,
  progress_image_mime TEXT,
  progress_image_size INTEGER CHECK (progress_image_size IS NULL OR progress_image_size >= 0),
  progress_image_sha256 TEXT,
  progress_image_created_at TEXT,
  password_hash TEXT NOT NULL,
  download_blocked INTEGER NOT NULL DEFAULT 0 CHECK (download_blocked IN (0, 1)),
  withdrawal_download_blocked INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_download_blocked IN (0, 1)),
  download_block_reason TEXT CHECK (
    download_block_reason IS NULL OR download_block_reason IN (
      'superseded_by_completed_descendant',
      'withdrawn',
      'delete_requested',
      'admin_blocked',
      'admin_hidden'
    )
  ),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  hidden_reason TEXT,
  collapsed_by_completion INTEGER NOT NULL DEFAULT 0 CHECK (collapsed_by_completion IN (0, 1)),
  collapsed_reason TEXT CHECK (
    collapsed_reason IS NULL OR collapsed_reason IN ('superseded_by_completed_descendant')
  ),
  collapsed_at TEXT,
  collapsed_by_version_id TEXT,
  chart_name TEXT,
  normalized_chart_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  withdrawn_at TEXT,
  delete_requested_at TEXT,
  hidden_at TEXT,
  download_blocked_at TEXT,
  FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_version_id) REFERENCES versions(id) ON DELETE RESTRICT,
  CHECK (
    (version_number = 1 AND parent_version_id IS NULL) OR
    (version_number > 1 AND parent_version_id IS NOT NULL)
  ),
  CHECK (
    (download_blocked = 0 AND download_block_reason IS NULL) OR
    (download_blocked = 1 AND download_block_reason IS NOT NULL)
  ),
  UNIQUE (chart_id, branch_path),
  UNIQUE (file_id),
  UNIQUE (file_sha256),
  UNIQUE (r2_key)
);

CREATE TABLE IF NOT EXISTS delete_requests (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  chart_id TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  requester_ip_hash TEXT NOT NULL,
  requester_ua_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at TEXT,
  handled_by TEXT,
  admin_note TEXT,
  FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS post_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('create_chart', 'append_version', 'withdraw_version', 'request_delete')),
  song_id TEXT,
  chart_id TEXT,
  version_id TEXT,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  file_sha256 TEXT,
  result TEXT NOT NULL CHECK (result IN ('accepted', 'rejected')),
  error_code TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE SET NULL,
  FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE SET NULL,
  FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bans (
  id TEXT PRIMARY KEY,
  ban_type TEXT NOT NULL CHECK (ban_type IN ('ip_hash', 'ua_hash', 'file_sha256')),
  ban_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expired_at TEXT,
  disabled_at TEXT,
  UNIQUE (ban_type, ban_value)
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  code TEXT,
  reason TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS version_withdrawals (
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
  handling_mode TEXT CHECK (
    handling_mode IS NULL OR handling_mode IN (
      'immediate_delete',
      'grace_auto_delete',
      'manual_review'
    )
  ),
  request_reason TEXT CHECK (
    request_reason IS NULL OR length(trim(request_reason)) BETWEEN 10 AND 500
  ),
  CHECK (scheduled_at >= requested_at)
);

CREATE TABLE IF NOT EXISTS version_source_metadata (
  version_id TEXT PRIMARY KEY,
  source_title TEXT CHECK (source_title IS NULL OR length(source_title) <= 4096),
  source_subtitle TEXT CHECK (source_subtitle IS NULL OR length(source_subtitle) <= 4096),
  source_artist TEXT CHECK (source_artist IS NULL OR length(source_artist) <= 4096),
  source_subartist TEXT CHECK (source_subartist IS NULL OR length(source_subartist) <= 4096),
  encoding TEXT CHECK (encoding IS NULL OR length(encoding) <= 64),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'unavailable')),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 128),
  analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE CASCADE,
  CHECK (
    (status = 'succeeded' AND error_code IS NULL) OR
    (status IN ('failed', 'unavailable') AND error_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_songs_normalized_identity
  ON songs (normalized_title, normalized_subtitle, normalized_artist, normalized_subartist);

CREATE INDEX IF NOT EXISTS idx_songs_normalized_artist_title
  ON songs (normalized_artist, normalized_title);

CREATE INDEX IF NOT EXISTS idx_songs_updated_at
  ON songs (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_charts_song_chart_name
  ON charts (song_id, normalized_chart_name);

CREATE INDEX IF NOT EXISTS idx_charts_visible_updated_at
  ON charts (is_hidden, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_versions_chart_tree
  ON versions (chart_id, branch_path);

CREATE INDEX IF NOT EXISTS idx_versions_parent
  ON versions (parent_version_id);

CREATE INDEX IF NOT EXISTS idx_versions_chart_visible_tree
  ON versions (chart_id, is_hidden, branch_path);

CREATE INDEX IF NOT EXISTS idx_versions_chart_version_number
  ON versions (chart_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_versions_completed_table
  ON versions (progress, download_blocked, is_hidden, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_versions_level_completed
  ON versions (level, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_versions_md5
  ON versions (md5);

CREATE INDEX IF NOT EXISTS idx_versions_file_sha256
  ON versions (file_sha256);

CREATE INDEX IF NOT EXISTS idx_versions_author
  ON versions (author);

CREATE INDEX IF NOT EXISTS idx_versions_difficulty
  ON versions (difficulty);

CREATE INDEX IF NOT EXISTS idx_versions_download_block_reason
  ON versions (download_block_reason, download_blocked_at DESC);

CREATE INDEX IF NOT EXISTS idx_versions_measure_range
  ON versions (first_note_measure, last_note_measure);

CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_progress_image_key
  ON versions (progress_image_key);

CREATE INDEX IF NOT EXISTS idx_versions_collapsed_completion
  ON versions (chart_id, collapsed_by_completion, branch_path);

CREATE INDEX IF NOT EXISTS idx_versions_collapsed_by_version
  ON versions (collapsed_by_version_id);

CREATE INDEX IF NOT EXISTS idx_versions_created_at
  ON versions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delete_requests_version
  ON delete_requests (version_id);

CREATE INDEX IF NOT EXISTS idx_delete_requests_chart
  ON delete_requests (chart_id);

CREATE INDEX IF NOT EXISTS idx_delete_requests_status_created_at
  ON delete_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_logs_ip_hash_created_at
  ON post_logs (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_logs_ua_hash_created_at
  ON post_logs (ua_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_logs_file_sha256
  ON post_logs (file_sha256);

CREATE INDEX IF NOT EXISTS idx_post_logs_song_chart_created_at
  ON post_logs (song_id, chart_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_logs_result_error_created_at
  ON post_logs (result, error_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bans_type_value_active
  ON bans (ban_type, ban_value, active);

CREATE INDEX IF NOT EXISTS idx_bans_active_expired_at
  ON bans (active, expired_at);

CREATE INDEX IF NOT EXISTS idx_admin_logs_action_created_at
  ON admin_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_target_created_at
  ON admin_logs (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_level_created_at
  ON admin_logs (level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_version_withdrawals_status_schedule
  ON version_withdrawals (status, scheduled_at, id);

CREATE INDEX IF NOT EXISTS idx_version_withdrawals_version_requested
  ON version_withdrawals (version_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_version_withdrawals_active_version
  ON version_withdrawals (version_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_version_withdrawals_handling_schedule
  ON version_withdrawals (status, handling_mode, scheduled_at, id);

CREATE INDEX IF NOT EXISTS idx_version_source_metadata_status_updated
  ON version_source_metadata (status, updated_at, version_id);
