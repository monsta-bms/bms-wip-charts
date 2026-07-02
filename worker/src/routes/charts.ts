import { analyzeBmsBuffer, BmsAnalysis, normalizeText, parseBmsMetadata } from "../utils/bms";
import { sanitizeFileName, validateUploadFile } from "../utils/fileValidation";
import { hashWithSecret, md5HexFromBuffer, sha256HexFromBuffer } from "../utils/hash";
import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

type ListParams = {
  page: number;
  pageSize: number;
  q: string;
  offset: number;
};

type ParseResult =
  | { ok: true; value: ListParams }
  | { ok: false; code: string; message: string; detail: string };

type ChartRow = {
  song_id: string;
  song_title: string;
  song_subtitle: string;
  song_artist: string;
  song_subartist: string;
  song_created_at: string;
  song_updated_at: string;
  chart_id: string;
  chart_name: string;
  chart_is_hidden: number;
  chart_hidden_reason: string | null;
  chart_created_at: string;
  chart_updated_at: string;
};

type VersionRow = {
  version_id: string;
  chart_id: string;
  parent_version_id: string | null;
  version_number: number;
  branch_label: string;
  branch_path: string;
  author: string;
  authors_json: string | null;
  progress: number;
  play_notes: number | null;
  first_note_measure: number | null;
  last_note_measure: number | null;
  target_measure_count: number | null;
  measure_notes_json: string | null;
  comment: string;
  difficulty: string | null;
  level: string | null;
  title: string;
  subtitle: string;
  artist: string;
  subartist: string;
  md5: string | null;
  is_rejected: number;
  file_id: string;
  file_name: string;
  file_size: number;
  file_sha256: string;
  download_blocked: number;
  download_block_reason: string | null;
  is_hidden: number;
  hidden_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  withdrawn_at: string | null;
  delete_requested_at: string | null;
  hidden_at: string | null;
  download_blocked_at: string | null;
};

type ExistingSongRow = {
  id: string;
};

type ExistingChartRow = {
  id: string;
};

type ExistingVersionRow = {
  id: string;
};

type PostLogContext = {
  ipHash: string;
  uaHash: string;
  songId?: string | null;
  chartId?: string | null;
  versionId?: string | null;
  fileSha256?: string | null;
};

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

type CreateChartInput = {
  file: File;
  fileName: string;
  fileBytes: ArrayBuffer;
  fileSha256: string;
  md5: string | null;
  bmsAnalysis: BmsAnalysis | null;
  analysisWarnings: ApiWarning[];
  title: string;
  subtitle: string;
  artist: string;
  subartist: string;
  chartName: string;
  difficulty: string;
  level: string;
  author: string;
  progress: number;
  comment: string;
  isRejected: boolean;
  passwordHash: string;
  metadataWarning: ApiWarning | null;
  parsedMetadata: {
    title: string | null;
    artist: string | null;
    encoding: string | null;
  };
  extension: string;
};

function parsePositiveInteger(
  rawValue: string | null,
  name: string,
  defaultValue: number,
  maxValue?: number
): { ok: true; value: number } | { ok: false; detail: string } {
  if (rawValue === null || rawValue.trim() === "") {
    return { ok: true, value: defaultValue };
  }

  const valueText = rawValue.trim();
  if (!/^\d+$/.test(valueText)) {
    return { ok: false, detail: `${name} must be a positive integer.` };
  }

  const value = Number(valueText);
  if (!Number.isSafeInteger(value) || value < 1) {
    return { ok: false, detail: `${name} must be a positive safe integer.` };
  }

  if (maxValue !== undefined && value > maxValue) {
    return { ok: false, detail: `${name} must be ${maxValue} or less.` };
  }

  return { ok: true, value };
}

function parseProgress(rawValue: string): { ok: true; value: number } | { ok: false; detail: string } {
  const valueText = rawValue.trim();
  if (!/^\d+$/.test(valueText)) {
    return { ok: false, detail: "progress must be an integer between 0 and 100." };
  }

  const value = Number(valueText);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    return { ok: false, detail: "progress must be an integer between 0 and 100." };
  }

  return { ok: true, value };
}

function extractLevelFromDifficulty(difficulty: string): string {
  const valueText = difficulty.trim();
  if (!valueText) {
    return "";
  }

  const starMatch = valueText.match(/^[★☆]\s*(\d+(?:\.\d+)?)$/u);
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

function parseListParams(url: URL): ParseResult {
  const page = parsePositiveInteger(url.searchParams.get("page"), "page", 1);
  if (!page.ok) {
    return {
      ok: false,
      code: "INVALID_QUERY_PARAM",
      message: "クエリパラメータが不正です。",
      detail: page.detail
    };
  }

  const pageSize = parsePositiveInteger(
    url.searchParams.get("pageSize"),
    "pageSize",
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  if (!pageSize.ok) {
    return {
      ok: false,
      code: "INVALID_QUERY_PARAM",
      message: "クエリパラメータが不正です。",
      detail: pageSize.detail
    };
  }

  const offset = (page.value - 1) * pageSize.value;
  if (!Number.isSafeInteger(offset)) {
    return {
      ok: false,
      code: "INVALID_QUERY_PARAM",
      message: "クエリパラメータが不正です。",
      detail: "page and pageSize produce an unsafe offset."
    };
  }

  return {
    ok: true,
    value: {
      page: page.value,
      pageSize: pageSize.value,
      q: (url.searchParams.get("q") ?? "").trim(),
      offset
    }
  };
}

function toBoolean(value: number): boolean {
  return value === 1;
}

function parseBooleanField(value: string): boolean {
  return ["1", "true", "on", "yes"].includes(value.trim().toLowerCase());
}

function isFormFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value;
}

function getFormText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getClientIpMarker(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cfIp) {
    return cfIp;
  }

  const forwardedFor = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwardedFor || "unknown";
}

function getUserAgentMarker(request: Request): string {
  return request.headers.get("User-Agent")?.trim() || "unknown";
}

async function buildPostLogContext(request: Request, secret: string): Promise<PostLogContext> {
  const ipHash = await hashWithSecret(`ip:${getClientIpMarker(request)}`, secret);
  const uaHash = await hashWithSecret(`ua:${getUserAgentMarker(request)}`, secret);
  return { ipHash, uaHash };
}

function buildBranchSuffix(row: VersionRow): string {
  if (row.version_number === 1 || row.branch_path === "root") {
    return "";
  }

  const branchLabel = row.branch_label.trim();
  if (branchLabel) {
    return branchLabel;
  }

  return row.branch_path
    .split("/")
    .filter((part) => part && part !== "root")
    .join("");
}

function buildDisplayVersion(row: VersionRow): string {
  const base = `ver${row.version_number}.0`;
  const suffix = buildBranchSuffix(row);
  return suffix ? `${base}-${suffix}` : base;
}

function parseStoredJson(value: string | null, fieldName: string, versionId: string): unknown | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error("[charts-list-json-parse] failed to parse stored JSON field", {
      code: "STORED_JSON_PARSE_FAILED",
      fieldName,
      versionId,
      message: errorDetail(error)
    });
    return null;
  }
}

function buildVersion(row: VersionRow) {
  const downloadBlocked = toBoolean(row.download_blocked);

  return {
    id: row.version_id,
    parentVersionId: row.parent_version_id,
    versionNumber: row.version_number,
    branchLabel: row.branch_label,
    branchPath: row.branch_path,
    displayVersion: buildDisplayVersion(row),
    author: row.author,
    authorsJson: row.authors_json,
    progress: row.progress,
    playNotes: row.play_notes,
    firstNoteMeasure: row.first_note_measure,
    lastNoteMeasure: row.last_note_measure,
    targetMeasureCount: row.target_measure_count,
    measureNotes: parseStoredJson(row.measure_notes_json, "measure_notes_json", row.version_id),
    completed: row.progress === 100,
    completedAt: row.completed_at,
    withdrawn: row.withdrawn_at !== null || row.download_block_reason === "withdrawn",
    withdrawnAt: row.withdrawn_at,
    deleteRequested: row.delete_requested_at !== null || row.download_block_reason === "delete_requested",
    deleteRequestedAt: row.delete_requested_at,
    hidden: toBoolean(row.is_hidden),
    hiddenReason: row.hidden_reason,
    hiddenAt: row.hidden_at,
    downloadBlocked,
    downloadBlockReason: row.download_block_reason,
    downloadBlockedAt: row.download_blocked_at,
    comment: row.comment,
    difficulty: row.difficulty,
    level: row.level,
    title: row.title,
    subtitle: row.subtitle,
    artist: row.artist,
    subartist: row.subartist,
    md5: row.md5,
    isRejected: toBoolean(row.is_rejected),
    file: {
      id: row.file_id,
      name: row.file_name,
      size: row.file_size,
      sha256: row.file_sha256,
      downloadUrl: downloadBlocked ? null : `/api/files/${encodeURIComponent(row.file_id)}`
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildChartEntry(chartRow: ChartRow, versionRows: VersionRow[]) {
  return {
    song: {
      id: chartRow.song_id,
      title: chartRow.song_title,
      subtitle: chartRow.song_subtitle,
      artist: chartRow.song_artist,
      subartist: chartRow.song_subartist,
      createdAt: chartRow.song_created_at,
      updatedAt: chartRow.song_updated_at
    },
    chart: {
      id: chartRow.chart_id,
      name: chartRow.chart_name,
      hidden: toBoolean(chartRow.chart_is_hidden),
      hiddenReason: chartRow.chart_hidden_reason,
      createdAt: chartRow.chart_created_at,
      updatedAt: chartRow.chart_updated_at
    },
    versions: versionRows.map(buildVersion)
  };
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
    ) VALUES (?, 'create_chart', ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

async function failCreateChart(
  request: Request,
  env: Env,
  context: PostLogContext,
  failure: ApiFailure
): Promise<Response> {
  try {
    await writePostLog(env, context, "rejected", failure.code, failure.detail);
  } catch (error) {
    console.error("[post-log-write] failed to write rejected create_chart log", {
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
    console.error("[r2-orphan-cleanup] failed to delete R2 object after DB insert failure", {
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
        "D1 insert failed after R2 upload, and R2 cleanup also failed.",
        `fileId=${fileId}; dbError=${errorDetail(originalError)}; cleanupError=${errorDetail(cleanupError)}`
      ).run();
    } catch (adminLogError) {
      console.error("[admin-log-write] failed to write R2 orphan admin log", {
        code: "ADMIN_LOG_WRITE_FAILED",
        fileId,
        r2Key,
        message: errorDetail(adminLogError)
      });
    }
  }
}

async function selectVisibleChartRows(env: Env, params: ListParams): Promise<ChartRow[]> {
  const result = await env.DB.prepare(`
    SELECT
      songs.id AS song_id,
      songs.title AS song_title,
      songs.subtitle AS song_subtitle,
      songs.artist AS song_artist,
      songs.subartist AS song_subartist,
      songs.created_at AS song_created_at,
      songs.updated_at AS song_updated_at,
      charts.id AS chart_id,
      charts.chart_name AS chart_name,
      charts.is_hidden AS chart_is_hidden,
      charts.hidden_reason AS chart_hidden_reason,
      charts.created_at AS chart_created_at,
      charts.updated_at AS chart_updated_at
    FROM charts
    INNER JOIN songs ON songs.id = charts.song_id
    WHERE charts.is_hidden = 0
      AND EXISTS (
        SELECT 1
        FROM versions
        WHERE versions.chart_id = charts.id
          AND versions.is_hidden = 0
      )
    ORDER BY charts.updated_at DESC, charts.id ASC
    LIMIT ? OFFSET ?
  `).bind(params.pageSize + 1, params.offset).all<ChartRow>();

  return result.results ?? [];
}

async function selectVisibleVersionRows(env: Env, chartIds: string[]): Promise<VersionRow[]> {
  if (chartIds.length === 0) {
    return [];
  }

  const placeholders = chartIds.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.chart_id AS chart_id,
      versions.parent_version_id AS parent_version_id,
      versions.version_number AS version_number,
      versions.branch_label AS branch_label,
      versions.branch_path AS branch_path,
      versions.author AS author,
      versions.authors_json AS authors_json,
      versions.progress AS progress,
      versions.play_notes AS play_notes,
      versions.first_note_measure AS first_note_measure,
      versions.last_note_measure AS last_note_measure,
      versions.target_measure_count AS target_measure_count,
      versions.measure_notes_json AS measure_notes_json,
      versions.comment AS comment,
      versions.difficulty AS difficulty,
      versions.level AS level,
      versions.title AS title,
      versions.subtitle AS subtitle,
      versions.artist AS artist,
      versions.subartist AS subartist,
      versions.md5 AS md5,
      versions.is_rejected AS is_rejected,
      versions.file_id AS file_id,
      versions.file_name AS file_name,
      versions.file_size AS file_size,
      versions.file_sha256 AS file_sha256,
      versions.download_blocked AS download_blocked,
      versions.download_block_reason AS download_block_reason,
      versions.is_hidden AS is_hidden,
      versions.hidden_reason AS hidden_reason,
      versions.created_at AS created_at,
      versions.updated_at AS updated_at,
      versions.completed_at AS completed_at,
      versions.withdrawn_at AS withdrawn_at,
      versions.delete_requested_at AS delete_requested_at,
      versions.hidden_at AS hidden_at,
      versions.download_blocked_at AS download_blocked_at
    FROM versions
    WHERE versions.is_hidden = 0
      AND versions.chart_id IN (${placeholders})
    ORDER BY versions.chart_id ASC, versions.branch_path ASC
  `).bind(...chartIds).all<VersionRow>();

  return result.results ?? [];
}

async function handleChartList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseListParams(url);

  if (!parsed.ok) {
    return apiError(
      request,
      env,
      400,
      parsed.code,
      parsed.message,
      parsed.detail
    );
  }

  const params = parsed.value;

  try {
    const chartRowsWithLookahead = await selectVisibleChartRows(env, params);
    const hasNext = chartRowsWithLookahead.length > params.pageSize;
    const chartRows = chartRowsWithLookahead.slice(0, params.pageSize);
    const chartIds = chartRows.map((row) => row.chart_id);
    const versionRows = await selectVisibleVersionRows(env, chartIds);

    const versionsByChartId = new Map<string, VersionRow[]>();
    for (const versionRow of versionRows) {
      const groupedRows = versionsByChartId.get(versionRow.chart_id) ?? [];
      groupedRows.push(versionRow);
      versionsByChartId.set(versionRow.chart_id, groupedRows);
    }

    return ok(request, env, {
      charts: chartRows.map((chartRow) => buildChartEntry(
        chartRow,
        versionsByChartId.get(chartRow.chart_id) ?? []
      )),
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        hasNext
      }
    });
  } catch (error) {
    console.error("[charts-list-d1-read] failed to read chart list from D1", {
      code: "D1_QUERY_FAILED",
      page: params.page,
      pageSize: params.pageSize,
      qProvided: params.q.length > 0,
      message: errorDetail(error)
    });

    return apiError(
      request,
      env,
      500,
      "D1_QUERY_FAILED",
      "投稿一覧の取得に失敗しました。",
      `D1 read failed in charts-list-d1-read: ${errorDetail(error)}`
    );
  }
}

async function parseCreateChartInput(
  request: Request,
  env: Env,
  context: PostLogContext,
  secret: string
): Promise<{ ok: true; value: CreateChartInput } | { ok: false; response: Response }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return {
      ok: false,
      response: await failCreateChart(request, env, context, {
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
    console.error("[create-chart-form-parse] failed to parse multipart form", {
      code: "INVALID_FORM",
      message: errorDetail(error)
    });

    return {
      ok: false,
      response: await failCreateChart(request, env, context, {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿フォームが不正です。",
        detail: `Failed to parse multipart/form-data: ${errorDetail(error)}`
      })
    };
  }

  const file = form.get("file");
  if (!isFormFile(file) || file.size <= 0) {
    return {
      ok: false,
      response: await failCreateChart(request, env, context, {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿ファイルが見つかりません。",
        detail: "file field must contain a non-empty file."
      })
    };
  }

  const password = getFormText(form, "password");
  if (!password) {
    return {
      ok: false,
      response: await failCreateChart(request, env, context, {
        status: 400,
        code: "PASSWORD_REQUIRED",
        message: "管理パスワードを入力してください。",
        detail: "password field is required."
      })
    };
  }

  const validation = validateUploadFile(file);
  if (!validation.ok) {
    return {
      ok: false,
      response: await failCreateChart(request, env, context, {
        status: 400,
        code: validation.code,
        message: validation.message,
        detail: validation.detail
      })
    };
  }

  const progress = parseProgress(getFormText(form, "progress"));
  if (!progress.ok) {
    return {
      ok: false,
      response: await failCreateChart(request, env, context, {
        status: 400,
        code: "INVALID_PROGRESS",
        message: "進捗度の値が不正です。",
        detail: progress.detail
      })
    };
  }

  const fileBytes = await file.arrayBuffer();
  const fileSha256 = await sha256HexFromBuffer(fileBytes);
  context.fileSha256 = fileSha256;

  let md5: string | null = null;
  let bmsAnalysis: BmsAnalysis | null = null;
  const analysisWarnings: ApiWarning[] = [];
  let metadataWarning: ApiWarning | null = null;
  let parsedMetadata = {
    title: null as string | null,
    artist: null as string | null,
    encoding: null as string | null
  };

  if (validation.isBmsText) {
    md5 = md5HexFromBuffer(fileBytes);

    try {
      const metadata = parseBmsMetadata(fileBytes);
      parsedMetadata = {
        title: metadata.title ?? null,
        artist: metadata.artist ?? null,
        encoding: metadata.encoding ?? null
      };
    } catch (error) {
      console.error("[bms-metadata-parse] failed to parse BMS metadata", {
        code: "BMS_METADATA_PARSE_FAILED",
        fileSha256,
        message: errorDetail(error)
      });

      metadataWarning = {
        code: "BMS_METADATA_PARSE_FAILED",
        message: "譜面情報の自動読み取りに失敗したため、フォーム入力値を使用しました。"
      };
    }

    try {
      bmsAnalysis = analyzeBmsBuffer(fileBytes);
      analysisWarnings.push(...bmsAnalysis.warnings);
    } catch (error) {
      console.error("[bms-analysis] failed to analyze BMS measure notes", {
        code: "BMS_ANALYSIS_FAILED",
        fileSha256,
        message: errorDetail(error)
      });

      analysisWarnings.push({
        code: "BMS_ANALYSIS_FAILED",
        message: "譜面の小節解析に失敗したため、進捗グラフ情報なしで投稿します。",
        detail: errorDetail(error)
      });
    }
  }

  const title = getFormText(form, "title") || parsedMetadata.title || "";
  const subtitle = getFormText(form, "subtitle");
  const artist = getFormText(form, "artist") || parsedMetadata.artist || "";
  const subartist = getFormText(form, "subartist");
  const chartName = getFormText(form, "chartName");
  const difficulty = getFormText(form, "difficulty");
  const submittedLevel = getFormText(form, "level");
  const level = submittedLevel || extractLevelFromDifficulty(difficulty);
  const author = getFormText(form, "author");
  const comment = getFormText(form, "comment");
  const isRejected = parseBooleanField(getFormText(form, "isRejected"));
  const storedProgress = isRejected ? 100 : progress.value;

  const missingFields = [
    ["title", title],
    ["artist", artist],
    ["chartName", chartName],
    ["author", author]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingFields.length > 0) {
    return {
      ok: false,
      response: await failCreateChart(request, env, context, {
        status: 400,
        code: "INVALID_FORM",
        message: "必須項目が不足しています。",
        detail: `Required fields are missing: ${missingFields.join(", ")}. BMS metadata can fill title/artist only when readable.`
      })
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
      title,
      subtitle,
      artist,
      subartist,
      chartName,
      difficulty,
      level,
      author,
      progress: storedProgress,
      comment,
      isRejected,
      passwordHash: await hashWithSecret(`password:${password}`, secret),
      metadataWarning,
      parsedMetadata,
      extension: validation.extension
    }
  };
}

async function handleCreateChart(request: Request, env: Env): Promise<Response> {
  const secret = env.HASH_SECRET?.trim();
  if (!secret) {
    console.error("[create-chart-config] HASH_SECRET secret is not configured", {
      code: "SERVER_CONFIG_ERROR",
      target: "HASH_SECRET"
    });

    return apiError(
      request,
      env,
      500,
      "SERVER_CONFIG_ERROR",
      "サーバー設定が不足しています。",
      "HASH_SECRET secret is not configured."
    );
  }

  let context: PostLogContext | null = null;

  try {
    context = await buildPostLogContext(request, secret);
    const parsed = await parseCreateChartInput(request, env, context, secret);
    if (!parsed.ok) {
      return parsed.response;
    }

    const input = parsed.value;
    const normalizedTitle = normalizeText(input.title);
    const normalizedSubtitle = normalizeText(input.subtitle);
    const normalizedArtist = normalizeText(input.artist);
    const normalizedSubartist = normalizeText(input.subartist);
    const normalizedChartName = normalizeText(input.chartName);

    let existingDuplicate: ExistingVersionRow | null;
    try {
      existingDuplicate = await env.DB.prepare(`
        SELECT id
        FROM versions
        WHERE file_sha256 = ?
        LIMIT 1
      `).bind(input.fileSha256).first<ExistingVersionRow>();
    } catch (error) {
      console.error("[create-chart-duplicate-check] failed to check duplicate file", {
        code: "DB_INSERT_FAILED",
        fileSha256: input.fileSha256,
        message: errorDetail(error)
      });

      return failCreateChart(request, env, context, {
        status: 500,
        code: "DB_INSERT_FAILED",
        message: "投稿前の確認に失敗しました。",
        detail: `Failed to check duplicate file_sha256: ${errorDetail(error)}`
      });
    }

    if (existingDuplicate) {
      return failCreateChart(request, env, context, {
        status: 409,
        code: "DUPLICATE_FILE",
        message: "同じファイルは投稿できません。",
        detail: "A version with the same file_sha256 already exists."
      });
    }

    let existingSong: ExistingSongRow | null;
    try {
      existingSong = await env.DB.prepare(`
        SELECT id
        FROM songs
        WHERE normalized_title = ?
          AND normalized_subtitle = ?
          AND normalized_artist = ?
          AND normalized_subartist = ?
        LIMIT 1
      `).bind(
        normalizedTitle,
        normalizedSubtitle,
        normalizedArtist,
        normalizedSubartist
      ).first<ExistingSongRow>();
    } catch (error) {
      console.error("[create-chart-song-lookup] failed to find existing song", {
        code: "DB_INSERT_FAILED",
        message: errorDetail(error)
      });

      return failCreateChart(request, env, context, {
        status: 500,
        code: "DB_INSERT_FAILED",
        message: "投稿前の確認に失敗しました。",
        detail: `Failed to lookup song: ${errorDetail(error)}`
      });
    }

    const songId = existingSong?.id ?? makeId("song");
    context.songId = songId;

    if (existingSong) {
      let existingChart: ExistingChartRow | null;
      try {
        existingChart = await env.DB.prepare(`
          SELECT id
          FROM charts
          WHERE song_id = ?
            AND normalized_chart_name = ?
          LIMIT 1
        `).bind(songId, normalizedChartName).first<ExistingChartRow>();
      } catch (error) {
        console.error("[create-chart-chart-lookup] failed to find existing chart", {
          code: "DB_INSERT_FAILED",
          songId,
          message: errorDetail(error)
        });

        return failCreateChart(request, env, context, {
          status: 500,
          code: "DB_INSERT_FAILED",
          message: "投稿前の確認に失敗しました。",
          detail: `Failed to lookup chart: ${errorDetail(error)}`
        });
      }

      if (existingChart) {
        context.chartId = existingChart.id;
        return failCreateChart(request, env, context, {
          status: 409,
          code: "CHART_ALREADY_EXISTS",
          message: "同じ曲の同じ差分は既に存在します。",
          detail: "Use POST /api/charts/:chartId/versions in a later phase to append to an existing chart."
        });
      }
    }

    const chartId = makeId("chart");
    const versionId = makeId("version");
    const fileId = makeId("file");
    const r2Key = `charts/${chartId}/versions/root/${fileId}${input.extension}`;
    const completedAt = input.progress === 100 ? new Date().toISOString() : null;
    const measureNotesJson = input.bmsAnalysis ? JSON.stringify(input.bmsAnalysis.measureNotesJson) : null;
    const responseWarnings: ApiWarning[] = [
      ...(input.metadataWarning ? [input.metadataWarning] : []),
      ...input.analysisWarnings
    ];
    const warningDetail = responseWarnings
      .map((warning) => warning.detail ? `${warning.code}:${warning.detail}` : warning.code)
      .join(", ") || "none";
    const analysisDetail = input.bmsAnalysis
      ? `bmsAnalysis=ok; playNotes=${input.bmsAnalysis.playNotes}; firstNoteMeasure=${input.bmsAnalysis.firstNoteMeasure ?? "null"}; lastNoteMeasure=${input.bmsAnalysis.lastNoteMeasure ?? "null"}; targetMeasureCount=${input.bmsAnalysis.targetMeasureCount}`
      : `bmsAnalysis=skipped_or_failed; extension=${input.extension}`;
    context.chartId = chartId;
    context.versionId = versionId;

    try {
      await env.FILES.put(r2Key, input.fileBytes, {
        httpMetadata: {
          contentType: input.file.type || "application/octet-stream"
        },
        customMetadata: {
          fileId,
          fileSha256: input.fileSha256
        }
      });
    } catch (error) {
      console.error("[create-chart-r2-upload] failed to upload chart file to R2", {
        code: "R2_UPLOAD_FAILED",
        chartId,
        versionId,
        fileId,
        message: errorDetail(error)
      });

      return failCreateChart(request, env, context, {
        status: 500,
        code: "R2_UPLOAD_FAILED",
        message: "ファイル保存に失敗しました。",
        detail: `R2 upload failed: ${errorDetail(error)}`
      });
    }

    const statements: D1PreparedStatement[] = [];
    if (!existingSong) {
      statements.push(env.DB.prepare(`
        INSERT INTO songs (
          id,
          title,
          subtitle,
          artist,
          subartist,
          normalized_title,
          normalized_subtitle,
          normalized_artist,
          normalized_subartist
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        songId,
        input.title,
        input.subtitle,
        input.artist,
        input.subartist,
        normalizedTitle,
        normalizedSubtitle,
        normalizedArtist,
        normalizedSubartist
      ));
    }

    statements.push(env.DB.prepare(`
      INSERT INTO charts (
        id,
        song_id,
        chart_name,
        normalized_chart_name
      ) VALUES (?, ?, ?, ?)
    `).bind(
      chartId,
      songId,
      input.chartName,
      normalizedChartName
    ));

    statements.push(env.DB.prepare(`
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
      ) VALUES (?, ?, NULL, 1, '', 'root', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).bind(
      versionId,
      chartId,
      input.author,
      input.progress,
      input.bmsAnalysis?.playNotes ?? null,
      input.bmsAnalysis?.firstNoteMeasure ?? null,
      input.bmsAnalysis?.lastNoteMeasure ?? null,
      input.bmsAnalysis?.targetMeasureCount ?? null,
      measureNotesJson,
      input.comment,
      input.difficulty || null,
      input.level || null,
      input.title,
      input.subtitle,
      input.artist,
      input.subartist,
      input.md5,
      input.isRejected ? 1 : 0,
      fileId,
      input.fileName,
      input.file.size,
      input.fileSha256,
      r2Key,
      input.passwordHash,
      completedAt
    ));

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
      ) VALUES (?, 'create_chart', ?, ?, ?, ?, ?, ?, 'accepted', NULL, ?)
    `).bind(
      makeId("post_log"),
      songId,
      chartId,
      versionId,
      context.ipHash,
      context.uaHash,
      input.fileSha256,
      `Initial chart version created. ${analysisDetail}; warnings=${warningDetail}`
    ));

    try {
      await env.DB.batch(statements);
    } catch (error) {
      console.error("[create-chart-db-insert] failed to insert initial chart", {
        code: "DB_INSERT_FAILED",
        songId,
        chartId,
        versionId,
        fileId,
        message: errorDetail(error)
      });

      await cleanupR2AfterDbFailure(env, r2Key, fileId, error);

      try {
        await writePostLog(
          env,
          context,
          "rejected",
          "DB_INSERT_FAILED",
          `D1 insert failed after R2 upload: ${errorDetail(error)}`
        );
      } catch (postLogError) {
        console.error("[post-log-write] failed to write DB insert failure log", {
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
        "DB_INSERT_FAILED",
        "投稿データの保存に失敗しました。",
        `D1 insert failed after R2 upload: ${errorDetail(error)}`
      );
    }

    return ok(request, env, {
      songId,
      chartId,
      versionId,
      fileId,
      displayVersion: "ver1.0",
      progress: input.progress,
      isRejected: input.isRejected,
      completed: input.progress === 100,
      completedAt,
      file: {
        name: input.fileName,
        size: input.file.size,
        sha256: input.fileSha256,
        md5: input.md5,
        downloadUrl: `/api/files/${encodeURIComponent(fileId)}`
      },
      metadata: input.parsedMetadata,
      analysis: input.bmsAnalysis ? {
        encoding: input.bmsAnalysis.encoding,
        playNotes: input.bmsAnalysis.playNotes,
        firstNoteMeasure: input.bmsAnalysis.firstNoteMeasure,
        lastNoteMeasure: input.bmsAnalysis.lastNoteMeasure,
        targetMeasureCount: input.bmsAnalysis.targetMeasureCount,
        measureNotes: input.bmsAnalysis.measureNotesJson
      } : null,
      warnings: responseWarnings
    }, { status: 201 });
  } catch (error) {
    console.error("[create-chart-unknown] unexpected create chart failure", {
      code: "UNKNOWN_ERROR",
      message: errorDetail(error)
    });

    if (context) {
      try {
        await writePostLog(
          env,
          context,
          "rejected",
          "UNKNOWN_ERROR",
          `Unexpected create chart failure: ${errorDetail(error)}`
        );
      } catch (postLogError) {
        console.error("[post-log-write] failed to write unknown failure log", {
          code: "POST_LOG_WRITE_FAILED",
          message: errorDetail(postLogError)
        });
      }
    }

    return apiError(
      request,
      env,
      500,
      "UNKNOWN_ERROR",
      "予期しないエラーが発生しました。",
      `Unexpected create chart failure: ${errorDetail(error)}`
    );
  }
}

export function handleChartsRoute(request: Request, env: Env): Promise<Response> | Response {
  if (request.method === "GET") {
    return handleChartList(request, env);
  }

  if (request.method === "POST") {
    return handleCreateChart(request, env);
  }

  return methodNotAllowed(request, env, request.method);
}

export function handleChartVersionsRoute(
  request: Request,
  env: Env,
  chartId: string
): Response {
  if (!chartId) {
    return apiError(
      request,
      env,
      400,
      "INVALID_CHART_ID",
      "曲IDが不正です。",
      "chartId path parameter is empty."
    );
  }

  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }

  return ok(request, env, {
    chartId,
    version: null,
    mode: "stub",
    message: "Version append is accepted only as a Phase 9 stub. D1 write and R2 upload are not implemented."
  }, { status: 201 });
}
