CREATE TABLE version_comments (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  fingerprint_hash_version INTEGER NOT NULL CHECK (fingerprint_hash_version IN (1, 2)),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  hidden_at TEXT,
  hidden_reason TEXT,
  FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE CASCADE
);

CREATE INDEX idx_version_comments_version_created_at
  ON version_comments (version_id, created_at, id);

CREATE INDEX idx_version_comments_fingerprint_created_at
  ON version_comments (ip_hash, ua_hash, created_at);

CREATE INDEX idx_version_comments_hidden_created_at
  ON version_comments (is_hidden, created_at);
