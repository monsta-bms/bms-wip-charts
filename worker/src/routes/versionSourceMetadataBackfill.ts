import { parseBmsMetadata } from "../utils/bms";
import {
  getFileExtension,
  SINGLE_CHART_MAX_BYTES,
  ZIP_MAX_BYTES
} from "../utils/fileValidation";
import { apiError, Env, ok } from "../utils/response";
import {
  buildVersionSourceMetadataBackfillStatement,
  PreparedVersionSourceMetadata,
  prepareVersionSourceMetadata,
  prepareVersionSourceMetadataFailure,
  VersionSourceMetadataStatus
} from "../utils/versionSourceMetadata";
import { inspectZipUpload } from "../utils/zipValidation";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_CURSOR_LENGTH = 160;
const MAX_DIAGNOSTIC_LOGS = 10;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,128}$/u;
const OPERATION = "version_source_metadata_backfill";

type BackfillRequest = {
  limit: number;
  afterVersionId: string | null;
  dryRun: boolean;
  retryFailed: boolean;
};

type CandidateRow = {
  version_id: string;
  file_name: string;
  file_size: number;
  r2_key: string;
  file_deleted_at: string | null;
  metadata_status: VersionSourceMetadataStatus | null;
};

type PersistedStateRow = {
  version_id: string | null;
  metadata_status: VersionSourceMetadataStatus | null;
};

type ResultStatus = VersionSourceMetadataStatus | "skipped";
type ResultAction = "would_insert" | "would_update" | "inserted" | "updated" | "skipped";

type BackfillResult = {
  versionId: string;
  status: ResultStatus;
  errorCode: string | null;
  action: ResultAction;
};

type BackfillSummary = {
  selectedCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  unavailableCount: number;
  skippedCount: number;
  writtenCount: number;
  hasMore: boolean;
  nextAfterVersionId: string | null;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function parseRequest(
  request: Request,
  env: Env
): Promise<{ ok: true; value: BackfillRequest } | { ok: false; response: Response }> {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "バックフィル条件が不正です。",
        "Content-Type must be application/json."
      )
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "バックフィル条件が不正です。",
        "Request body must be valid JSON."
      )
    };
  }

  if (!isRecord(body)) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "バックフィル条件が不正です。",
        "Request body must be a JSON object."
      )
    };
  }

  const limit = body.limit === undefined ? DEFAULT_LIMIT : body.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "limitを確認してください。",
        `limit must be an integer between 1 and ${MAX_LIMIT}.`
      )
    };
  }

  const afterVersionId = body.afterVersionId === undefined || body.afterVersionId === null
    ? null
    : body.afterVersionId;
  if (typeof afterVersionId !== "string" && afterVersionId !== null) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "afterVersionIdを確認してください。",
        "afterVersionId must be a string or null."
      )
    };
  }
  if (afterVersionId !== null && Array.from(afterVersionId).length > MAX_CURSOR_LENGTH) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "afterVersionIdを確認してください。",
        `afterVersionId must be ${MAX_CURSOR_LENGTH} characters or less.`
      )
    };
  }

  const dryRun = body.dryRun === undefined ? true : body.dryRun;
  if (typeof dryRun !== "boolean") {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "dryRunを確認してください。",
        "dryRun must be a boolean."
      )
    };
  }

  const retryFailed = body.retryFailed === undefined ? false : body.retryFailed;
  if (typeof retryFailed !== "boolean") {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_SOURCE_METADATA_BACKFILL_REQUEST",
        "retryFailedを確認してください。",
        "retryFailed must be a boolean."
      )
    };
  }

  return {
    ok: true,
    value: { limit, afterVersionId, dryRun, retryFailed }
  };
}

async function selectCandidates(env: Env, input: BackfillRequest): Promise<CandidateRow[]> {
  const cursorCondition = input.afterVersionId === null ? "" : "AND versions.id > ?";
  const retryCondition = input.retryFailed
    ? "(metadata.version_id IS NULL OR metadata.status IN ('failed', 'unavailable'))"
    : "metadata.version_id IS NULL";
  const statement = env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.file_name,
      versions.file_size,
      versions.r2_key,
      versions.file_deleted_at,
      metadata.status AS metadata_status
    FROM versions
    LEFT JOIN version_source_metadata AS metadata
      ON metadata.version_id = versions.id
    WHERE ${retryCondition}
      ${cursorCondition}
    ORDER BY versions.id ASC
    LIMIT ?
  `);
  const bound = input.afterVersionId === null
    ? statement.bind(input.limit + 1)
    : statement.bind(input.afterVersionId, input.limit + 1);
  const result = await bound.all<CandidateRow>();
  return result.results;
}

function metadataFromParsedBms(bytes: ArrayBuffer): PreparedVersionSourceMetadata {
  try {
    const metadata = parseBmsMetadata(bytes);
    return prepareVersionSourceMetadata({
      parsedMetadata: {
        title: metadata.title ?? null,
        subtitle: metadata.subtitle ?? null,
        artist: metadata.artist ?? null,
        subartist: metadata.subartist ?? null,
        encoding: metadata.encoding ?? null
      },
      metadataWarning: null
    });
  } catch {
    return prepareVersionSourceMetadata({
      parsedMetadata: {},
      metadataWarning: { code: "BMS_METADATA_PARSE_FAILED" }
    });
  }
}

function safeZipFailureCode(code: string): string {
  return SAFE_ERROR_CODE_PATTERN.test(code) ? code : "SOURCE_ZIP_INSPECTION_FAILED";
}

async function analyzeCandidate(
  candidate: CandidateRow,
  env: Env
): Promise<PreparedVersionSourceMetadata> {
  if (candidate.file_deleted_at !== null) {
    return prepareVersionSourceMetadataFailure("unavailable", "SOURCE_FILE_DELETED");
  }

  const extension = getFileExtension(candidate.file_name);
  if (![".bms", ".bme", ".bml", ".zip"].includes(extension)) {
    return prepareVersionSourceMetadataFailure("failed", "SOURCE_FILE_TYPE_UNSUPPORTED");
  }
  const maximumBytes = extension === ".zip" ? ZIP_MAX_BYTES : SINGLE_CHART_MAX_BYTES;
  if (
    !Number.isSafeInteger(candidate.file_size)
    || candidate.file_size < 0
    || candidate.file_size > maximumBytes
  ) {
    return prepareVersionSourceMetadataFailure("failed", "SOURCE_FILE_READ_FAILED");
  }

  let object: R2ObjectBody | null;
  try {
    object = await env.FILES.get(candidate.r2_key);
  } catch {
    return prepareVersionSourceMetadataFailure("failed", "SOURCE_FILE_READ_FAILED");
  }
  if (object === null) {
    return prepareVersionSourceMetadataFailure("unavailable", "SOURCE_R2_OBJECT_MISSING");
  }
  if (object.size > maximumBytes) {
    return prepareVersionSourceMetadataFailure("failed", "SOURCE_FILE_READ_FAILED");
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await object.arrayBuffer();
  } catch {
    return prepareVersionSourceMetadataFailure("failed", "SOURCE_FILE_READ_FAILED");
  }

  if (extension !== ".zip") {
    return metadataFromParsedBms(bytes);
  }

  try {
    const inspection = await inspectZipUpload(
      new File([bytes], candidate.file_name, { type: "application/zip" })
    );
    if (!inspection.ok) {
      return prepareVersionSourceMetadataFailure(
        "failed",
        safeZipFailureCode(inspection.failure.code)
      );
    }
    return metadataFromParsedBms(inspection.chart.bytes);
  } catch {
    return prepareVersionSourceMetadataFailure("failed", "SOURCE_ZIP_INSPECTION_FAILED");
  }
}

async function persistedState(env: Env, versionId: string): Promise<PersistedStateRow | null> {
  return env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      metadata.status AS metadata_status
    FROM versions
    LEFT JOIN version_source_metadata AS metadata
      ON metadata.version_id = versions.id
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<PersistedStateRow>();
}

async function persistResult(
  candidate: CandidateRow,
  metadata: PreparedVersionSourceMetadata,
  input: BackfillRequest,
  env: Env
): Promise<BackfillResult> {
  const intendedAction = candidate.metadata_status === null ? "insert" : "update";
  if (input.dryRun) {
    return {
      versionId: candidate.version_id,
      status: metadata.status,
      errorCode: metadata.errorCode,
      action: intendedAction === "insert" ? "would_insert" : "would_update"
    };
  }

  const write = await buildVersionSourceMetadataBackfillStatement(
    env.DB,
    candidate.version_id,
    metadata,
    input.retryFailed
  ).run();
  if (Number(write.meta.changes ?? 0) === 1) {
    return {
      versionId: candidate.version_id,
      status: metadata.status,
      errorCode: metadata.errorCode,
      action: intendedAction === "insert" ? "inserted" : "updated"
    };
  }

  const latest = await persistedState(env, candidate.version_id);
  if (latest === null || latest.version_id === null) {
    return {
      versionId: candidate.version_id,
      status: "skipped",
      errorCode: "SOURCE_VERSION_STATE_CHANGED",
      action: "skipped"
    };
  }
  if (latest.metadata_status !== null) {
    return {
      versionId: candidate.version_id,
      status: "skipped",
      errorCode: null,
      action: "skipped"
    };
  }

  throw new Error("Conditional metadata write completed without a persisted state.");
}

async function processCandidate(
  candidate: CandidateRow,
  input: BackfillRequest,
  env: Env
): Promise<BackfillResult> {
  try {
    const metadata = await analyzeCandidate(candidate, env);
    return await persistResult(candidate, metadata, input, env);
  } catch {
    console.error("[version-source-metadata-backfill] candidate failed", {
      code: "SOURCE_METADATA_BACKFILL_FAILED",
      versionId: candidate.version_id
    });
    const failed = prepareVersionSourceMetadataFailure(
      "failed",
      "SOURCE_METADATA_BACKFILL_FAILED"
    );
    try {
      return await persistResult(candidate, failed, input, env);
    } catch {
      return {
        versionId: candidate.version_id,
        status: "failed",
        errorCode: "SOURCE_METADATA_BACKFILL_FAILED",
        action: "skipped"
      };
    }
  }
}

function summarize(
  selectedCount: number,
  results: BackfillResult[],
  hasMore: boolean,
  nextAfterVersionId: string | null
): BackfillSummary {
  return {
    selectedCount,
    processedCount: results.length,
    succeededCount: results.filter((result) => result.status === "succeeded").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    unavailableCount: results.filter((result) => result.status === "unavailable").length,
    skippedCount: results.filter((result) => result.action === "skipped").length,
    writtenCount: results.filter((result) => result.action === "inserted" || result.action === "updated").length,
    hasMore,
    nextAfterVersionId
  };
}

async function writeAdminLog(
  env: Env,
  values: {
    targetType: "system" | "version";
    targetId: string;
    level: "info" | "warning" | "error";
    code: string | null;
    reason: "completed" | "completed_with_errors" | "failed" | "candidate_failed" | "unavailable";
    detail: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_logs (
        id, action, target_type, target_id, level, code, reason, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      makeId("admin_log"),
      OPERATION,
      values.targetType,
      values.targetId,
      values.level,
      values.code,
      values.reason,
      JSON.stringify(values.detail)
    ).run();
  } catch {
    console.error("[version-source-metadata-backfill] admin log write failed", {
      code: "ADMIN_LOG_WRITE_FAILED",
      targetType: values.targetType,
      targetId: values.targetId
    });
  }
}

async function writeCandidateDiagnostics(
  env: Env,
  runId: string,
  results: BackfillResult[]
): Promise<void> {
  const diagnostics = results
    .filter((result) => result.status === "failed" || result.status === "unavailable")
    .slice(0, MAX_DIAGNOSTIC_LOGS);
  for (const result of diagnostics) {
    await writeAdminLog(env, {
      targetType: "version",
      targetId: result.versionId,
      level: "warning",
      code: result.errorCode,
      reason: result.status === "unavailable" ? "unavailable" : "candidate_failed",
      detail: {
        operation: OPERATION,
        run_id: runId,
        error_code: result.errorCode
      }
    });
  }
}

async function writeSummaryLog(
  env: Env,
  runId: string,
  input: BackfillRequest,
  summary: BackfillSummary,
  durationMs: number,
  fatal: boolean
): Promise<void> {
  const hasErrors = fatal
    || summary.failedCount > 0
    || summary.unavailableCount > 0
    || summary.skippedCount > 0;
  await writeAdminLog(env, {
    targetType: "system",
    targetId: runId,
    level: fatal ? "error" : hasErrors ? "warning" : "info",
    code: fatal ? "SOURCE_METADATA_BACKFILL_FAILED" : null,
    reason: fatal ? "failed" : hasErrors ? "completed_with_errors" : "completed",
    detail: {
      operation: OPERATION,
      run_id: runId,
      dry_run: false,
      retry_failed: input.retryFailed,
      limit: input.limit,
      selected_count: summary.selectedCount,
      processed_count: summary.processedCount,
      succeeded_count: summary.succeededCount,
      failed_count: summary.failedCount,
      unavailable_count: summary.unavailableCount,
      skipped_count: summary.skippedCount,
      written_count: summary.writtenCount,
      has_more: summary.hasMore,
      next_after_version_id: summary.nextAfterVersionId,
      duration_ms: durationMs
    }
  });
}

export async function backfillVersionSourceMetadata(
  request: Request,
  env: Env
): Promise<Response> {
  const parsed = await parseRequest(request, env);
  if (!parsed.ok) {
    return parsed.response;
  }
  const input = parsed.value;
  const runId = makeId("source_metadata_backfill");
  const startedAt = Date.now();

  let candidateRows: CandidateRow[];
  try {
    candidateRows = await selectCandidates(env, input);
  } catch {
    console.error("[version-source-metadata-backfill] candidate selection failed", {
      code: "SOURCE_METADATA_BACKFILL_FAILED",
      runId
    });
    if (!input.dryRun) {
      await writeSummaryLog(
        env,
        runId,
        input,
        summarize(0, [], false, null),
        Date.now() - startedAt,
        true
      );
    }
    return apiError(
      request,
      env,
      500,
      "SOURCE_METADATA_BACKFILL_FAILED",
      "元メタ情報バックフィルに失敗しました。",
      "Candidate selection failed."
    );
  }

  const selected = candidateRows.slice(0, input.limit);
  const hasMore = candidateRows.length > input.limit;
  const nextAfterVersionId = selected.length === 0
    ? null
    : selected[selected.length - 1].version_id;
  const results: BackfillResult[] = [];
  for (const candidate of selected) {
    results.push(await processCandidate(candidate, input, env));
  }
  const summary = summarize(selected.length, results, hasMore, nextAfterVersionId);

  if (!input.dryRun) {
    await writeCandidateDiagnostics(env, runId, results);
    await writeSummaryLog(
      env,
      runId,
      input,
      summary,
      Date.now() - startedAt,
      false
    );
  }

  return ok(request, env, {
    ok: true,
    runId,
    dryRun: input.dryRun,
    retryFailed: input.retryFailed,
    limit: input.limit,
    afterVersionId: input.afterVersionId,
    ...summary,
    results
  });
}
