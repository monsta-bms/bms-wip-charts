import { BmsAnalysis, normalizeText } from "../utils/bms";
import { analyzeUploadedBmsBytes } from "../utils/bmsUploadAnalysis";
import { sanitizeFileName, validateUploadFile } from "../utils/fileValidation";
import { hashWithSecret, sha256HexFromBuffer } from "../utils/hash";
import { prepareAppendProgressMap } from "../utils/progressMap";
import { buildRequestFingerprint } from "../utils/requestFingerprint";
import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";
import { buildZipInspectionLogDetail, inspectZipUpload } from "../utils/zipValidation";
import { findActiveFileBan } from "./bans";

type ApiFailure = {
  status: number;
  code: string;
  message: string;
  detail: string;
};

type ApiWarning = {
  code: string;
  message: string;
  detail?: string;
};

type PostLogContext = {
  ipHash: string;
  uaHash: string;
  songId?: string | null;
  chartId?: string | null;
  versionId?: string | null;
  fileSha256?: string | null;
};

type ChartRow = {
  chart_id: string;
  chart_name: string;
  chart_is_hidden: number;
  song_id: string;
  song_title: string;
  song_subtitle: string;
  song_artist: string;
  song_subartist: string;
};

type ParentVersionRow = {
  id: string;
  chart_id: string;
  version_number: number;
  branch_path: string;
  progress_map_json: string | null;
  difficulty: string | null;
  level: string | null;
  is_hidden: number;
  is_rejected: number;
};

type ExistingVersionRow = { id: string };
type ChildCountRow = { child_count: number };

type AppendVersionInput = {
  file: File;
  fileName: string;
  fileBytes: ArrayBuffer;
  fileSha256: string;
  md5: string | null;
  bmsAnalysis: BmsAnalysis | null;
  analysisWarnings: ApiWarning[];
  bmsAnalysisFailed: boolean;
  parentVersionId: string;
  difficulty: string;
  level: string;
  author: string;
  progressMapText: string;
  comment: string;
  passwordHash: string;
  parsedMetadata: {
    title: string | null;
    subtitle: string | null;
    artist: string | null;
    subartist: string | null;
    encoding: string | null;
  };
  metadataWarning: ApiWarning | null;
  extension: string;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function buildPostLogContext(request: Request, secret: string): Promise<PostLogContext> {
  const fingerprint = await buildRequestFingerprint(request, secret);
  return { ipHash: fingerprint.ipHash, uaHash: fingerprint.uaHash };
}

function parseBooleanField(value: string): boolean {
  return ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
}

function isFormFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "size" in value;
}

function getFormText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function extractLevelFromDifficulty(difficulty: string): string {
  const valueText = difficulty.trim();
  if (!valueText) {
    return "";
  }

  const starMatch = valueText.match(/^[★☆]+\s*(\d+(?:\.\d+)?)$/u);
  if (starMatch) {
    return starMatch[1];
  }

  const tableMatch = valueText.match(/^(?:st|sl)\s*(\d+(?:\.\d+)?)$/i);
  if (tableMatch) {
    return tableMatch[1];
  }

  const numericMatch = valueText.match(/^(\d+(?:\.\d+)?)$/);
  return numericMatch ? numericMatch[1] : "";
}

function buildBranchLabel(index: number): string {
  let value = index;
  let label = "";

  do {
    label = String.fromCharCode(97 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return label;
}

function buildDisplayVersion(versionNumber: number, branchLabel: string, branchPath: string): string {
  const suffix = branchLabel.trim() || branchPath
    .split("/")
    .filter((part) => part && part !== "root")
    .join("");
  const base = `ver${versionNumber}.0`;
  return suffix ? `${base}-${suffix}` : base;
}

function metadataTextMatches(uploadedValue: string | null, existingValue: string): boolean {
  const uploaded = normalizeText(uploadedValue ?? "");
  const existing = normalizeText(existingValue);
  if (!uploaded || !existing) {
    return true;
  }

  // TODO: Replace this tolerant check with a stricter title/diff-name parser when BMS title conventions are finalized.
  return uploaded === existing || uploaded.includes(existing) || existing.includes(uploaded);
}

async function writePostLog(
  env: Env,
  context: PostLogContext,
  result: "accepted" | "rejected",
  errorCode: string | null,
  detail: string
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO post_logs (
      id,
      action,
      song_id,
      chart_id,
      version_id,
      ip_hash,
      ua_hash,
      file_sha256,
      result,
      error_code,
      detail
    ) VALUES (?, 'append_version', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    makeId("post_log"),
    context.songId ?? null,
    context.chartId ?? null,
    context.versionId ?? null,
    context.ipHash,
    context.uaHash,
    context.fileSha256 ?? null,
    result,
    errorCode,
    detail
  ).run();
}

async function failAppendVersion(
  request: Request,
  env: Env,
  context: PostLogContext,
  failure: ApiFailure
): Promise<Response> {
  try {
    await writePostLog(env, context, "rejected", failure.code, failure.detail);
  } catch (error) {
    console.error("[post-log-write] failed to write rejected append_version log", {
      code: "POST_LOG_WRITE_FAILED",
      errorCode: failure.code,
      message: errorDetail(error)
    });
  }

  return apiError(request, env, failure.status, failure.code, failure.message, failure.detail);
}

async function cleanupR2AfterDbFailure(
  env: Env,
  r2Key: string,
  fileId: string,
  originalError: unknown
): Promise<void> {
  try {
    await env.FILES.delete(r2Key);
  } catch (cleanupError) {
    console.error("[r2-orphan-cleanup] failed to delete R2 object after append DB failure", {
      code: "R2_ORPHAN_CLEANUP_FAILED",
      fileId,
      r2Key,
      dbMessage: errorDetail(originalError),
      cleanupMessage: errorDetail(cleanupError)
    });

    try {
      await env.DB.prepare(`
        INSERT INTO admin_logs (
          id,
          action,
          target_type,
          target_id,
          level,
          code,
          reason,
          detail
        ) VALUES (?, 'r2_orphan_file', 'r2_key', ?, 'error', 'R2_ORPHAN_FILE', ?, ?)
      `).bind(
        makeId("admin_log"),
        r2Key,
        "Append version D1 insert failed after R2 upload, and R2 cleanup also failed.",
        `fileId=${fileId}; dbError=${errorDetail(originalError)}; cleanupError=${errorDetail(cleanupError)}`
      ).run();
    } catch (adminLogError) {
      console.error("[admin-log-write] failed to write append R2 orphan admin log", {
        code: "ADMIN_LOG_WRITE_FAILED",
        fileId,
        r2Key,
        message: errorDetail(adminLogError)
      });
    }
  }
}

async function parseAppendVersionInput(
  request: Request,
  env: Env,
  context: PostLogContext,
  secret: string
): Promise<{ ok: true; value: AppendVersionInput } | { ok: false; response: Response }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿フォームが不正です。",
        detail: "Content-Type must be multipart/form-data."
      })
    };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    console.error("[append-version-form-parse] failed to parse multipart form", {
      code: "INVALID_FORM",
      message: errorDetail(error)
    });

    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿フォームが不正です。",
        detail: `Failed to parse multipart/form-data: ${errorDetail(error)}`
      })
    };
  }

  if (parseBooleanField(getFormText(form, "isRejected"))) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 400,
        code: "INVALID_REJECTED_FLAG_FOR_FOLLOWUP",
        message: "追記投稿では没譜面チェックを指定できません。",
        detail: "isRejected=true is not allowed for POST /api/charts/:chartId/versions."
      })
    };
  }

  const file = form.get("file");
  if (!isFormFile(file) || file.size <= 0) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿ファイルが見つかりません。",
        detail: "file field must contain a non-empty file."
      })
    };
  }

  const parentVersionId = getFormText(form, "parentVersionId");
  const author = getFormText(form, "author");
  const progressMapText = getFormText(form, "progressMap");
  const password = getFormText(form, "password");
  const missingFields = [
    ["parentVersionId", parentVersionId],
    ["author", author],
    ["progressMap", progressMapText],
    ["password", password]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingFields.length > 0) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 400,
        code: "INVALID_FORM",
        message: "必須項目が不足しています。",
        detail: `Required fields are missing: ${missingFields.join(", ")}.`
      })
    };
  }

  const validation = validateUploadFile(file);
  if (!validation.ok) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 400,
        code: validation.code,
        message: validation.message,
        detail: validation.detail
      })
    };
  }

  const fileBytes = await file.arrayBuffer();
  const fileSha256 = await sha256HexFromBuffer(fileBytes);
  context.fileSha256 = fileSha256;

  let md5: string | null = null;
  let bmsAnalysis: BmsAnalysis | null = null;
  const analysisWarnings: ApiWarning[] = [];
  let bmsAnalysisFailed = false;
  let metadataWarning: ApiWarning | null = null;
  let parsedMetadata = {
    title: null as string | null,
    subtitle: null as string | null,
    artist: null as string | null,
    subartist: null as string | null,
    encoding: null as string | null
  };

  if (validation.isBmsText) {
    const analyzed = analyzeUploadedBmsBytes(fileBytes);
    md5 = analyzed.md5;
    bmsAnalysis = analyzed.analysis;
    bmsAnalysisFailed = analyzed.analysisFailed;
    analysisWarnings.push(...analyzed.analysisWarnings);
    metadataWarning = analyzed.metadataWarning;
    parsedMetadata = {
      title: analyzed.metadata.title ?? null,
      subtitle: analyzed.metadata.subtitle ?? null,
      artist: analyzed.metadata.artist ?? null,
      subartist: analyzed.metadata.subartist ?? null,
      encoding: analyzed.metadata.encoding ?? null
    };
  }

  return {
    ok: true,
    value: {
      file,
      fileName: sanitizeFileName(file.name),
      fileBytes,
      fileSha256,
      md5,
      bmsAnalysis,
      analysisWarnings,
      bmsAnalysisFailed,
      parentVersionId,
      difficulty: getFormText(form, "difficulty"),
      level: getFormText(form, "level"),
      author,
      progressMapText,
      comment: getFormText(form, "comment"),
      passwordHash: await hashWithSecret(`password:${password}`, secret),
      parsedMetadata,
      metadataWarning,
      extension: validation.extension
    }
  };
}

async function selectChart(env: Env, chartId: string): Promise<ChartRow | null> {
  return env.DB.prepare(`
    SELECT
      charts.id AS chart_id,
      charts.chart_name AS chart_name,
      charts.is_hidden AS chart_is_hidden,
      songs.id AS song_id,
      songs.title AS song_title,
      songs.subtitle AS song_subtitle,
      songs.artist AS song_artist,
      songs.subartist AS song_subartist
    FROM charts
    INNER JOIN songs ON songs.id = charts.song_id
    WHERE charts.id = ?
    LIMIT 1
  `).bind(chartId).first<ChartRow>();
}

async function selectParentVersion(env: Env, parentVersionId: string): Promise<ParentVersionRow | null> {
  return env.DB.prepare(`
    SELECT
      id,
      chart_id,
      version_number,
      branch_path,
      progress_map_json,
      difficulty,
      level,
      is_hidden,
      is_rejected
    FROM versions
    WHERE id = ?
    LIMIT 1
  `).bind(parentVersionId).first<ParentVersionRow>();
}

async function validateChartAndParent(
  request: Request,
  env: Env,
  context: PostLogContext,
  chartId: string,
  parentVersionId: string
): Promise<{ ok: true; value: { chart: ChartRow; parent: ParentVersionRow } } | { ok: false; response: Response }> {
  let chart: ChartRow | null;
  let parent: ParentVersionRow | null;

  try {
    chart = await selectChart(env, chartId);
    parent = await selectParentVersion(env, parentVersionId);
  } catch (error) {
    console.error("[append-version-parent-lookup] failed to read chart or parent version", {
      code: "DB_READ_FAILED",
      chartId,
      parentVersionId,
      message: errorDetail(error)
    });
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 500,
        code: "DB_READ_FAILED",
        message: "追記元の確認に失敗しました。",
        detail: `Failed to lookup chart or parent version: ${errorDetail(error)}`
      })
    };
  }

  if (!chart || chart.chart_is_hidden === 1) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 404,
        code: "CHART_NOT_FOUND",
        message: "対象の差分が見つかりません。",
        detail: `chartId not found or hidden: ${chartId}`
      })
    };
  }

  context.songId = chart.song_id;
  context.chartId = chart.chart_id;

  if (!parent) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 404,
        code: "PARENT_VERSION_NOT_FOUND",
        message: "追記元のバージョンが見つかりません。",
        detail: `parentVersionId not found: ${parentVersionId}`
      })
    };
  }

  if (parent.chart_id !== chartId) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 409,
        code: "PARENT_VERSION_CHART_MISMATCH",
        message: "追記元のバージョンが指定差分に属していません。",
        detail: `parentVersionId belongs to chart ${parent.chart_id}, not ${chartId}.`
      })
    };
  }

  if (parent.is_hidden === 1) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 404,
        code: "PARENT_VERSION_NOT_FOUND",
        message: "追記元のバージョンが見つかりません。",
        detail: `parentVersionId is hidden: ${parentVersionId}`
      })
    };
  }

  if (parent.is_rejected === 1) {
    return {
      ok: false,
      response: await failAppendVersion(request, env, context, {
        status: 409,
        code: "REJECTED_CHART_CANNOT_BE_EXTENDED",
        message: "没譜面から追記投稿はできません。",
        detail: `parentVersionId is rejected: ${parentVersionId}`
      })
    };
  }

  return { ok: true, value: { chart, parent } };
}

async function countExistingChildren(env: Env, parentVersionId: string): Promise<number> {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS child_count
    FROM versions
    WHERE parent_version_id = ?
  `).bind(parentVersionId).first<ChildCountRow>();
  return Number(row?.child_count ?? 0);
}

function buildSafeR2Key(chartId: string, branchPath: string, fileId: string, extension: string): string {
  const safeBranchPath = branchPath
    .split("/")
    .map((part) => part.replace(/[^A-Za-z0-9_-]/g, "_") || "branch")
    .join("/");
  return `charts/${chartId}/versions/${safeBranchPath}/${fileId}${extension}`;
}

async function handleAppendVersion(request: Request, env: Env, chartId: string): Promise<Response> {
  const secret = env.HASH_SECRET?.trim();
  if (!secret) {
    console.error("[append-version-config] HASH_SECRET secret is not configured", {
      code: "SERVER_CONFIG_ERROR",
      target: "HASH_SECRET"
    });
    return apiError(request, env, 500, "SERVER_CONFIG_ERROR", "サーバー設定が不足しています。", "HASH_SECRET secret is not configured.");
  }

  const context = await buildPostLogContext(request, secret);
  context.chartId = chartId;

  try {
    const parsed = await parseAppendVersionInput(request, env, context, secret);
    if (!parsed.ok) {
      return parsed.response;
    }

    const input = parsed.value;
    try {
      if (await findActiveFileBan(env, input.fileSha256)) {
        return failAppendVersion(request, env, context, {
          status: 403,
          code: "POSTING_BLOCKED",
          message: "投稿が制限されています。",
          detail: "Posting is not available."
        });
      }
    } catch (error) {
      console.error("[append-version-file-ban-check] failed before R2 upload", {
        code: "BAN_CHECK_FAILED",
        chartId,
        message: errorDetail(error)
      });
      return failAppendVersion(request, env, context, {
        status: 503,
        code: "BAN_CHECK_FAILED",
        message: "投稿可否の確認に失敗しました。",
        detail: "File posting protection lookup failed."
      });
    }
    const parentValidation = await validateChartAndParent(request, env, context, chartId, input.parentVersionId);
    if (!parentValidation.ok) {
      return parentValidation.response;
    }

    const { chart, parent } = parentValidation.value;

    let existingDuplicate: ExistingVersionRow | null;
    try {
      existingDuplicate = await env.DB.prepare(`
        SELECT id
        FROM versions
        WHERE file_sha256 = ?
        LIMIT 1
      `).bind(input.fileSha256).first<ExistingVersionRow>();
    } catch (error) {
      console.error("[append-version-duplicate-check] failed to check duplicate file", {
        code: "DB_READ_FAILED",
        message: errorDetail(error)
      });
      return failAppendVersion(request, env, context, {
        status: 500,
        code: "DB_READ_FAILED",
        message: "追記前の確認に失敗しました。",
        detail: `Failed to check duplicate file_sha256: ${errorDetail(error)}`
      });
    }

    if (existingDuplicate) {
      return failAppendVersion(request, env, context, {
        status: 409,
        code: "DUPLICATE_FILE",
        message: "同じファイルは投稿できません。",
        detail: "A version with the same file_sha256 already exists."
      });
    }

    if (input.extension === ".zip") {
      let inspection;
      try {
        inspection = await inspectZipUpload(input.file);
      } catch (error) {
        console.error("[append-version-zip-inspection] unexpected ZIP inspection failure", {
          code: "ZIP_INSPECTION_FAILED",
          chartId,
          errorType: error instanceof Error ? error.name : typeof error
        });
        return failAppendVersion(request, env, context, {
          status: 503,
          code: "ZIP_INSPECTION_FAILED",
          message: "ZIPの安全確認に失敗しました。しばらく待ってから再試行してください。",
          detail: buildZipInspectionLogDetail("ZIP_INSPECTION_FAILED")
        });
      }

      if (!inspection.ok) {
        return failAppendVersion(request, env, context, {
          status: 400,
          code: inspection.failure.code,
          message: inspection.failure.message,
          detail: inspection.failure.detail
        });
      }

      const analyzed = analyzeUploadedBmsBytes(inspection.chart.bytes);
      input.md5 = analyzed.md5;
      input.bmsAnalysis = analyzed.analysis;
      input.bmsAnalysisFailed = analyzed.analysisFailed;
      input.analysisWarnings = [...analyzed.analysisWarnings];
      input.metadataWarning = analyzed.metadataWarning;
      input.parsedMetadata = {
        title: analyzed.metadata.title ?? null,
        subtitle: analyzed.metadata.subtitle ?? null,
        artist: analyzed.metadata.artist ?? null,
        subartist: analyzed.metadata.subartist ?? null,
        encoding: analyzed.metadata.encoding ?? null
      };
    }

    if (!metadataTextMatches(input.parsedMetadata.title, chart.song_title) || !metadataTextMatches(input.parsedMetadata.artist, chart.song_artist)) {
      console.error("[append-version-title-artist-check] BMS metadata does not match parent song", {
        code: "TITLE_ARTIST_MISMATCH",
        chartId,
        parentVersionId: input.parentVersionId,
        parsedTitle: input.parsedMetadata.title,
        parsedArtist: input.parsedMetadata.artist
      });
      return failAppendVersion(request, env, context, {
        status: 409,
        code: "TITLE_ARTIST_MISMATCH",
        message: "譜面ファイルの曲名またはアーティストが追記先と一致しません。",
        detail: "Uploaded BMS #TITLE/#ARTIST does not match the target song title/artist after normalization."
      });
    }

    let childCount: number;
    try {
      childCount = await countExistingChildren(env, input.parentVersionId);
    } catch (error) {
      console.error("[append-version-branch-count] failed to count child versions", {
        code: "BRANCH_CREATE_FAILED",
        parentVersionId: input.parentVersionId,
        message: errorDetail(error)
      });
      return failAppendVersion(request, env, context, {
        status: 500,
        code: "BRANCH_CREATE_FAILED",
        message: "分岐番号の作成に失敗しました。",
        detail: `Failed to count existing child versions: ${errorDetail(error)}`
      });
    }

    const branchLabel = buildBranchLabel(childCount);
    const branchPath = `${parent.branch_path}/${branchLabel}`;
    const versionNumber = parent.version_number + 1;
    const displayVersion = buildDisplayVersion(versionNumber, branchLabel, branchPath);
    const versionId = makeId("version");
    const fileId = makeId("file");
    const r2Key = buildSafeR2Key(chartId, branchPath, fileId, input.extension);

    const preparedProgressMap = prepareAppendProgressMap({
      rawProgressMap: input.progressMapText,
      versionId,
      parentProgressMapJson: parent.progress_map_json,
      bmsAnalysis: input.bmsAnalysis,
      isZip: input.extension === ".zip",
      analysisFailed: input.bmsAnalysisFailed
    });
    if (!preparedProgressMap.ok) {
      console.error("[append-version-progress-map] invalid progress map payload", {
        code: preparedProgressMap.failure.code,
        chartId,
        parentVersionId: input.parentVersionId,
        versionId,
        message: preparedProgressMap.failure.detail
      });
      return failAppendVersion(request, env, context, preparedProgressMap.failure);
    }

    const storedProgress = preparedProgressMap.progress;
    const completedAt = storedProgress === 100 ? new Date().toISOString() : null;
    const difficulty = input.difficulty || parent.difficulty || null;
    const level = input.level || parent.level || (difficulty ? extractLevelFromDifficulty(difficulty) : "") || null;
    const measureNotesJson = input.bmsAnalysis ? JSON.stringify(input.bmsAnalysis.measureNotesJson) : null;
    const title = input.parsedMetadata.title || chart.song_title;
    const artist = input.parsedMetadata.artist || chart.song_artist;
    const responseWarnings: ApiWarning[] = [
      ...(input.metadataWarning ? [input.metadataWarning] : []),
      ...input.analysisWarnings
    ];
    const warningDetail = responseWarnings.map((warning) => warning.detail ? `${warning.code}:${warning.detail}` : warning.code).join(", ") || "none";
    const analysisDetail = input.bmsAnalysis
      ? `bmsAnalysis=ok; playNotes=${input.bmsAnalysis.playNotes}; firstNoteMeasure=${input.bmsAnalysis.firstNoteMeasure ?? "null"}; lastNoteMeasure=${input.bmsAnalysis.lastNoteMeasure ?? "null"}; targetMeasureCount=${input.bmsAnalysis.targetMeasureCount}`
      : `bmsAnalysis=skipped_or_failed; extension=${input.extension}`;

    try {
      await env.FILES.put(r2Key, input.fileBytes, {
        httpMetadata: { contentType: input.file.type || "application/octet-stream" },
        customMetadata: { fileId, fileSha256: input.fileSha256 }
      });
    } catch (error) {
      console.error("[append-version-r2-upload] failed to upload chart file to R2", {
        code: "R2_UPLOAD_FAILED",
        chartId,
        parentVersionId: input.parentVersionId,
        versionId,
        fileId,
        message: errorDetail(error)
      });
      return failAppendVersion(request, env, context, {
        status: 500,
        code: "R2_UPLOAD_FAILED",
        message: "ファイル保存に失敗しました。",
        detail: `R2 upload failed: ${errorDetail(error)}`
      });
    }

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO versions (
          id,
          chart_id,
          parent_version_id,
          version_number,
          branch_label,
          branch_path,
          author,
          authors_json,
          progress,
          play_notes,
          first_note_measure,
          last_note_measure,
          target_measure_count,
          measure_notes_json,
          progress_map_json,
          comment,
          difficulty,
          level,
          title,
          subtitle,
          artist,
          subartist,
          md5,
          is_rejected,
          file_id,
          file_name,
          file_size,
          file_sha256,
          r2_key,
          password_hash,
          download_blocked,
          download_block_reason,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
      `).bind(
        versionId,
        chartId,
        input.parentVersionId,
        versionNumber,
        branchLabel,
        branchPath,
        input.author,
        storedProgress,
        input.bmsAnalysis?.playNotes ?? null,
        input.bmsAnalysis?.firstNoteMeasure ?? null,
        input.bmsAnalysis?.lastNoteMeasure ?? null,
        input.bmsAnalysis?.targetMeasureCount ?? null,
        measureNotesJson,
        preparedProgressMap.progressMapJson,
        input.comment,
        difficulty,
        level,
        title,
        chart.song_subtitle,
        artist,
        chart.song_subartist,
        input.md5,
        fileId,
        input.fileName,
        input.file.size,
        input.fileSha256,
        r2Key,
        input.passwordHash,
        completedAt
      ),
      env.DB.prepare(`
        UPDATE charts
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(chartId)
    ];

    if (storedProgress === 100) {
      statements.push(env.DB.prepare(`
        UPDATE versions
        SET
          download_blocked = 1,
          download_block_reason = 'superseded_by_completed_descendant',
          download_blocked_at = COALESCE(download_blocked_at, CURRENT_TIMESTAMP),
          collapsed_by_completion = 1,
          collapsed_reason = 'superseded_by_completed_descendant',
          collapsed_at = COALESCE(collapsed_at, CURRENT_TIMESTAMP),
          collapsed_by_version_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE chart_id = ?
          AND is_hidden = 0
          AND progress BETWEEN 1 AND 99
          AND branch_path <> ?
          AND ? LIKE branch_path || '/%'
      `).bind(versionId, chartId, branchPath, branchPath));
    }

    statements.push(env.DB.prepare(`
      INSERT INTO post_logs (
        id,
        action,
        song_id,
        chart_id,
        version_id,
        ip_hash,
        ua_hash,
        file_sha256,
        result,
        error_code,
        detail
      ) VALUES (?, 'append_version', ?, ?, ?, ?, ?, ?, 'accepted', NULL, ?)
    `).bind(
      makeId("post_log"),
      chart.song_id,
      chartId,
      versionId,
      context.ipHash,
      context.uaHash,
      input.fileSha256,
      `Follow-up version created. parentVersionId=${input.parentVersionId}; branchPath=${branchPath}; ${analysisDetail}; progress=${storedProgress}; progressMap=saved; warnings=${warningDetail}`
    ));

    try {
      await env.DB.batch(statements);
    } catch (error) {
      const detail = errorDetail(error);
      const branchConflict = detail.includes("versions.chart_id") && detail.includes("versions.branch_path");
      const code = branchConflict ? "BRANCH_CREATE_FAILED" : "VERSION_INSERT_FAILED";
      console.error("[append-version-db-insert] failed to insert follow-up version", {
        code,
        chartId,
        parentVersionId: input.parentVersionId,
        versionId,
        fileId,
        branchPath,
        message: detail
      });
      await cleanupR2AfterDbFailure(env, r2Key, fileId, error);

      try {
        await writePostLog(env, context, "rejected", code, `D1 append insert failed after R2 upload: ${detail}`);
      } catch (postLogError) {
        console.error("[post-log-write] failed to write append DB insert failure log", {
          code: "POST_LOG_WRITE_FAILED",
          chartId,
          versionId,
          message: errorDetail(postLogError)
        });
      }

      return apiError(
        request,
        env,
        500,
        code,
        branchConflict ? "分岐番号の作成に失敗しました。" : "追記データの保存に失敗しました。",
        `D1 append insert failed after R2 upload: ${detail}`
      );
    }

    return ok(request, env, {
      chartId,
      parentVersionId: input.parentVersionId,
      versionId,
      displayVersion,
      branchPath,
      progress: storedProgress,
      progressMap: preparedProgressMap.progressMap,
      fileId,
      file: {
        name: input.fileName,
        size: input.file.size,
        sha256: input.fileSha256,
        md5: input.md5,
        downloadUrl: `/api/files/${encodeURIComponent(fileId)}`
      },
      analysis: input.bmsAnalysis ? {
        encoding: input.bmsAnalysis.encoding,
        playNotes: input.bmsAnalysis.playNotes,
        firstNoteMeasure: input.bmsAnalysis.firstNoteMeasure,
        lastNoteMeasure: input.bmsAnalysis.lastNoteMeasure,
        targetMeasureCount: input.bmsAnalysis.targetMeasureCount,
        measureNotes: input.bmsAnalysis.measureNotesJson
      } : null,
      warnings: responseWarnings,
      message: "created"
    }, { status: 201 });
  } catch (error) {
    console.error("[append-version-unknown] unexpected append version failure", {
      code: "UNKNOWN_ERROR",
      chartId,
      message: errorDetail(error)
    });

    try {
      await writePostLog(env, context, "rejected", "UNKNOWN_ERROR", `Unexpected append version failure: ${errorDetail(error)}`);
    } catch (postLogError) {
      console.error("[post-log-write] failed to write append unknown failure log", {
        code: "POST_LOG_WRITE_FAILED",
        chartId,
        message: errorDetail(postLogError)
      });
    }

    return apiError(
      request,
      env,
      500,
      "UNKNOWN_ERROR",
      "予期しないエラーが発生しました。",
      `Unexpected append version failure: ${errorDetail(error)}`
    );
  }
}

export function handleChartVersionsRoute(request: Request, env: Env, chartId: string): Promise<Response> | Response {
  if (!chartId) {
    return apiError(request, env, 400, "INVALID_CHART_ID", "曲IDが不正です。", "chartId path parameter is empty.");
  }

  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }

  return handleAppendVersion(request, env, chartId);
}
