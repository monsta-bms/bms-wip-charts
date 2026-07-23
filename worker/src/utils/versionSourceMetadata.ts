const MAX_SOURCE_METADATA_LENGTH = 4096;
const MAX_SOURCE_ENCODING_LENGTH = 64;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,128}$/u;
const FALLBACK_PARSE_ERROR_CODE = "SOURCE_METADATA_PARSE_FAILED";
const VALUE_TOO_LONG_ERROR_CODE = "SOURCE_METADATA_VALUE_TOO_LONG";

export type VersionSourceMetadataStatus = "succeeded" | "failed" | "unavailable";

export type VersionSourceMetadataInput = {
  parsedMetadata: {
    title?: string | null;
    subtitle?: string | null;
    artist?: string | null;
    subartist?: string | null;
    encoding?: string | null;
  };
  metadataWarning: { code: string } | null;
};

export type PreparedVersionSourceMetadata = {
  sourceTitle: string | null;
  sourceSubtitle: string | null;
  sourceArtist: string | null;
  sourceSubartist: string | null;
  encoding: string | null;
  status: VersionSourceMetadataStatus;
  errorCode: string | null;
};

function nullableSourceValue(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isTooLong(value: string | null, maximumLength: number): boolean {
  return value !== null && codePointLength(value) > maximumLength;
}

function safeWarningCode(code: string): string {
  return SAFE_ERROR_CODE_PATTERN.test(code) ? code : FALLBACK_PARSE_ERROR_CODE;
}

export function prepareVersionSourceMetadata(
  input: VersionSourceMetadataInput
): PreparedVersionSourceMetadata {
  const sourceTitle = nullableSourceValue(input.parsedMetadata.title);
  const sourceSubtitle = nullableSourceValue(input.parsedMetadata.subtitle);
  const sourceArtist = nullableSourceValue(input.parsedMetadata.artist);
  const sourceSubartist = nullableSourceValue(input.parsedMetadata.subartist);
  const encoding = nullableSourceValue(input.parsedMetadata.encoding);

  if (
    isTooLong(sourceTitle, MAX_SOURCE_METADATA_LENGTH)
    || isTooLong(sourceSubtitle, MAX_SOURCE_METADATA_LENGTH)
    || isTooLong(sourceArtist, MAX_SOURCE_METADATA_LENGTH)
    || isTooLong(sourceSubartist, MAX_SOURCE_METADATA_LENGTH)
    || isTooLong(encoding, MAX_SOURCE_ENCODING_LENGTH)
  ) {
    return {
      sourceTitle: null,
      sourceSubtitle: null,
      sourceArtist: null,
      sourceSubartist: null,
      encoding: null,
      status: "failed",
      errorCode: VALUE_TOO_LONG_ERROR_CODE
    };
  }

  if (input.metadataWarning) {
    return {
      sourceTitle: null,
      sourceSubtitle: null,
      sourceArtist: null,
      sourceSubartist: null,
      encoding,
      status: "failed",
      errorCode: safeWarningCode(input.metadataWarning.code)
    };
  }

  return {
    sourceTitle,
    sourceSubtitle,
    sourceArtist,
    sourceSubartist,
    encoding,
    status: "succeeded",
    errorCode: null
  };
}

export function buildVersionSourceMetadataInsertStatement(
  database: D1Database,
  versionId: string,
  metadata: PreparedVersionSourceMetadata
): D1PreparedStatement {
  return database.prepare(`
    INSERT INTO version_source_metadata (
      version_id,
      source_title,
      source_subtitle,
      source_artist,
      source_subartist,
      encoding,
      status,
      error_code,
      analyzed_at,
      created_at,
      updated_at
    )
    SELECT
      ?, ?, ?, ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    WHERE EXISTS (
      SELECT 1 FROM versions WHERE id = ?
    )
  `).bind(
    versionId,
    metadata.sourceTitle,
    metadata.sourceSubtitle,
    metadata.sourceArtist,
    metadata.sourceSubartist,
    metadata.encoding,
    metadata.status,
    metadata.errorCode,
    versionId
  );
}
