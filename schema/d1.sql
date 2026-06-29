-- Canonical D1 schema for BMS WIP Charts.
-- This file mirrors worker/migrations/0001_initial.sql for Dashboard SQL execution.
-- Production data does not exist yet, so this schema intentionally replaces the MVP schema.

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
  comment TEXT NOT NULL DEFAULT '',
  difficulty TEXT,
  level TEXT,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL,
  subartist TEXT NOT NULL DEFAULT '',
  md5 TEXT,
  is_rejected INTEGER NOT NULL DEFAULT 0 CHECK (is_rejected IN (0, 1)),
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  file_sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  download_blocked INTEGER NOT NULL DEFAULT 0 CHECK (download_blocked IN (0, 1)),
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
