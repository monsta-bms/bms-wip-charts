ALTER TABLE versions
ADD COLUMN allow_append INTEGER NOT NULL DEFAULT 1
CHECK (allow_append IN (0, 1));

UPDATE versions
SET allow_append = 0
WHERE is_rejected = 1;
