-- SECURITY-HASH-DOMAIN-SEPARATION
-- Existing persistent hashes are legacy version 1. New Worker writes use HMAC version 2.

ALTER TABLE versions
  ADD COLUMN password_hash_version INTEGER NOT NULL DEFAULT 1
  CHECK (password_hash_version IN (1, 2));

ALTER TABLE post_logs
  ADD COLUMN fingerprint_hash_version INTEGER NOT NULL DEFAULT 1
  CHECK (fingerprint_hash_version IN (1, 2));

ALTER TABLE bans
  ADD COLUMN ban_hash_version INTEGER
  CHECK (ban_hash_version IS NULL OR ban_hash_version IN (1, 2));

UPDATE bans
SET ban_hash_version = 1
WHERE ban_type IN ('ip_hash', 'ua_hash');

-- Raw IP/UA values are not retained, so legacy hash bans cannot be re-keyed safely.
UPDATE bans
SET
  active = 0,
  disabled_at = COALESCE(disabled_at, CURRENT_TIMESTAMP),
  updated_at = CURRENT_TIMESTAMP
WHERE ban_type IN ('ip_hash', 'ua_hash')
  AND ban_hash_version = 1
  AND active = 1;

ALTER TABLE version_withdrawals
  ADD COLUMN idempotency_hash_version INTEGER NOT NULL DEFAULT 1
  CHECK (idempotency_hash_version IN (1, 2));

ALTER TABLE version_withdrawals
  ADD COLUMN fingerprint_hash_version INTEGER NOT NULL DEFAULT 1
  CHECK (fingerprint_hash_version IN (1, 2));

ALTER TABLE delete_requests
  ADD COLUMN fingerprint_hash_version INTEGER NOT NULL DEFAULT 1
  CHECK (fingerprint_hash_version IN (1, 2));

CREATE INDEX idx_versions_password_hash_version
  ON versions (password_hash_version, id);

CREATE INDEX idx_post_logs_fingerprint_version_ip_created
  ON post_logs (fingerprint_hash_version, ip_hash, created_at DESC);

CREATE INDEX idx_post_logs_fingerprint_version_ua_created
  ON post_logs (fingerprint_hash_version, ua_hash, created_at DESC);

CREATE INDEX idx_bans_hash_version_type_value_active
  ON bans (ban_hash_version, ban_type, ban_value, active);

CREATE INDEX idx_version_withdrawals_idempotency_version_hash
  ON version_withdrawals (idempotency_hash_version, idempotency_key_hash);

CREATE INDEX idx_delete_requests_fingerprint_version_created
  ON delete_requests (fingerprint_hash_version, created_at DESC);
