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

export function handleChartsRoute(request: Request, env: Env): Promise<Response> | Response {
  if (request.method === "GET") {
    return handleChartList(request, env);
  }

  if (request.method === "POST") {
    return ok(request, env, {
      chartId: null,
      version: "ver1.0",
      mode: "stub",
      message: "D1 write, R2 upload, BMS metadata parsing, and zip inspection are not implemented in Phase 9."
    }, { status: 201 });
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
