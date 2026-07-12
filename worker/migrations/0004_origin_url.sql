-- ORIGIN-URL-01: optional original song distribution URL per version snapshot.
ALTER TABLE versions
ADD COLUMN origin_url TEXT
CHECK (
  origin_url IS NULL OR
  length(origin_url) BETWEEN 1 AND 2048
);
