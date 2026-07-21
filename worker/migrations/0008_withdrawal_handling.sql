-- WITHDRAWAL-LIFECYCLE-16R: distinguish automatic deletion from manual review.

ALTER TABLE version_withdrawals
  ADD COLUMN handling_mode TEXT CHECK (
    handling_mode IS NULL OR handling_mode IN (
      'immediate_delete',
      'grace_auto_delete',
      'manual_review'
    )
  );

ALTER TABLE version_withdrawals
  ADD COLUMN request_reason TEXT CHECK (
    request_reason IS NULL OR length(trim(request_reason)) BETWEEN 10 AND 500
  );

ALTER TABLE versions
  ADD COLUMN withdrawal_download_blocked INTEGER NOT NULL DEFAULT 0
  CHECK (withdrawal_download_blocked IN (0, 1));

UPDATE version_withdrawals
SET handling_mode = CASE
  WHEN request_mode = 'immediate' THEN 'immediate_delete'
  WHEN EXISTS (
    SELECT 1 FROM versions AS children
    WHERE children.parent_version_id = version_withdrawals.version_id
  ) OR EXISTS (
    SELECT 1 FROM versions AS refs
    WHERE refs.collapsed_by_version_id = version_withdrawals.version_id
  ) OR EXISTS (
    SELECT 1 FROM delete_requests AS requests
    WHERE requests.version_id = version_withdrawals.version_id
  ) THEN 'manual_review'
  ELSE 'grace_auto_delete'
END
WHERE handling_mode IS NULL;

-- A pre-migration deferred finalizer may have been left in processing. Once it
-- is classified for manual review, return it to a non-automatic pending state
-- while preserving its attempt/error audit fields.
UPDATE version_withdrawals
SET
  status = 'pending',
  processing_mode = NULL,
  lease_token = NULL,
  lease_expires_at = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'processing'
  AND handling_mode = 'manual_review';

UPDATE versions
SET withdrawal_download_blocked = 1
WHERE EXISTS (
  SELECT 1
  FROM version_withdrawals AS withdrawals
  WHERE withdrawals.version_id = versions.id
    AND withdrawals.status = 'pending'
    AND withdrawals.handling_mode IN ('grace_auto_delete', 'manual_review')
);

CREATE INDEX idx_version_withdrawals_handling_schedule
  ON version_withdrawals (status, handling_mode, scheduled_at, id);
