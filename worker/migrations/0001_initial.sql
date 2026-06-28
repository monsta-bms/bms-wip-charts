-- Phase 10-A initial D1 schema for BMS WIP Charts.
-- Apply with: wrangler d1 migrations apply wip-bms-charts-db

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS charts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  normalized_artist TEXT NOT NULL,
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  hidden_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  chart_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  difficulty TEXT,
  author TEXT NOT NULL,
  progress INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  comment TEXT,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  file_sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  hidden_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE RESTRICT,
  UNIQUE (chart_id, version_number),
  UNIQUE (file_id),
  UNIQUE (file_sha256),
  UNIQUE (r2_key)
);

CREATE TABLE IF NOT EXISTS post_logs (
  id TEXT PRIMARY KEY,
  chart_id TEXT,
  version_id TEXT,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  file_sha256 TEXT,
  action TEXT NOT NULL CHECK (action IN ('create_chart', 'append_version')),
  result TEXT NOT NULL CHECK (result IN ('accepted', 'rejected')),
  error_code TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chart_id) REFERENCES charts(id) ON DELETE SET NULL,
  FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bans (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('ip_hash', 'ua_hash', 'file_sha256')),
  target_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (target_type, target_hash)
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  code TEXT,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_charts_visible_title_artist
  ON charts (is_hidden, normalized_title, normalized_artist);

CREATE INDEX IF NOT EXISTS idx_charts_updated_at
  ON charts (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_versions_chart_visible_version
  ON versions (chart_id, is_hidden, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_versions_file_sha256
  ON versions (file_sha256);

CREATE INDEX IF NOT EXISTS idx_versions_created_at
  ON versions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_logs_ip_hash_created_at
  ON post_logs (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_logs_ua_hash_created_at
  ON post_logs (ua_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_logs_file_sha256
  ON post_logs (file_sha256);

CREATE INDEX IF NOT EXISTS idx_post_logs_result_error_created_at
  ON post_logs (result, error_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bans_target_active
  ON bans (target_type, target_hash, is_active);

CREATE INDEX IF NOT EXISTS idx_admin_logs_action_created_at
  ON admin_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_level_created_at
  ON admin_logs (level, created_at DESC);
