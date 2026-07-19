import { normalizeText } from "../utils/bms";
import { apiError, Env, methodNotAllowed, ok } from "../utils/response";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 100;
const MAX_FAVORITE_VERSION_IDS = 200;
const MAX_VERSION_ID_LENGTH = 160;
const MAX_COMMENT_PREVIEW_CODE_POINTS = 80;

type VersionListSort = "new" | "updated";
type VersionListStatus = "all" | "incomplete" | "complete" | "rejected";

type VersionListParams = {
  q: string;
  normalizedQuery: string;
  sort: VersionListSort;
  status: VersionListStatus;
  page: number;
  pageSize: number;
  offset: number;
  favoriteVersionIds: string[] | null;
  dateFrom: string | null;
  dateTo: string | null;
  dateFromUtc: string | null;
  dateToExclusiveUtc: string | null;
};

type VersionListRow = {
  version_id: string;
  chart_id: string;
  version_created_at: string;
  chart_created_at: string;
  chart_updated_at: string;
  song_title: string;
  song_subtitle: string;
  song_artist: string;
  song_subartist: string;
  chart_name: string;
  difficulty: string | null;
  level: string | null;
  author: string;
  comment: string | null;
  progress: number;
  is_rejected: number;
  withdrawn_at: string | null;
  delete_requested_at: string | null;
  download_blocked: number;
  download_block_reason: string | null;
  branch_path: string;
  new_until: string;
  is_new: number;
};

type CountRow = {
  total: number;
  server_time: string;
};

type ParseFailure = {
  status: number;
  code: string;
  message: string;
  detail: string;
};

type ParseResult =
  | { ok: true; value: VersionListParams }
  | { ok: false; failure: ParseFailure };

type VersionListBody = {
  favoriteVersionIds?: unknown;
  q?: unknown;
  sort?: unknown;
  status?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  page?: unknown;
  pageSize?: unknown;
};

const PUBLIC_VERSION_CONDITIONS = [
  "charts.is_hidden = 0",
  "versions.is_hidden = 0",
  "COALESCE(versions.collapsed_by_completion, 0) = 0"
];

function invalidParam(detail: string, favoriteQuery: boolean): ParseResult {
  return {
    ok: false,
    failure: {
      status: 400,
      code: favoriteQuery ? "INVALID_FAVORITE_QUERY" : "INVALID_QUERY_PARAM",
      message: favoriteQuery ? "お気に入り一覧の条件が不正です。" : "クエリパラメータが不正です。",
      detail
    }
  };
}

function parsePositiveInteger(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  maxValue?: number
): { ok: true; value: number } | { ok: false; detail: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: defaultValue };
  }

  const source = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^\d+$/.test(source)) {
    return { ok: false, detail: `${fieldName} must be a positive integer.` };
  }

  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maxValue !== undefined && parsed > maxValue)) {
    return {
      ok: false,
      detail: maxValue === undefined
        ? `${fieldName} must be a safe positive integer.`
        : `${fieldName} must be between 1 and ${maxValue}.`
    };
  }

  return { ok: true, value: parsed };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDateOnly(value: unknown, fieldName: string): { ok: true; value: string | null } | { ok: false; detail: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, detail: `${fieldName} must be a YYYY-MM-DD string.` };
  }

  const source = value.trim();
  if (source !== value) {
    return { ok: false, detail: `${fieldName} must use YYYY-MM-DD without surrounding whitespace.` };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) {
    return { ok: false, detail: `${fieldName} must use YYYY-MM-DD.` };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, detail: `${fieldName} must be a real calendar date.` };
  }
  return { ok: true, value: source };
}

function previousCalendarDate(value: string): string {
  let [year, month, day] = value.split("-").map(Number);
  if (day > 1) {
    day -= 1;
  } else if (month > 1) {
    month -= 1;
    day = daysInMonth(year, month);
  } else {
    year -= 1;
    month = 12;
    day = 31;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function jstDateStartAsUtc(value: string): string {
  return `${previousCalendarDate(value)} 15:00:00`;
}

function jstDateEndExclusiveAsUtc(value: string): string {
  return `${value} 15:00:00`;
}

function parseCommonParams(
  values: {
    q: unknown;
    sort: unknown;
    status: unknown;
    dateFrom: unknown;
    dateTo: unknown;
    page: unknown;
    pageSize: unknown;
  },
  favoriteVersionIds: string[] | null,
  favoriteQuery: boolean
): ParseResult {
  if (values.q !== null && values.q !== undefined && typeof values.q !== "string") {
    return invalidParam("q must be a string.", favoriteQuery);
  }

  const q = String(values.q ?? "").trim();
  if (Array.from(q).length > MAX_QUERY_LENGTH) {
    return invalidParam(`q must be ${MAX_QUERY_LENGTH} characters or less.`, favoriteQuery);
  }

  const sort = String(values.sort ?? "new").trim() || "new";
  if (sort !== "new" && sort !== "updated") {
    return invalidParam("sort must be new or updated.", favoriteQuery);
  }

  const status = String(values.status ?? "all").trim() || "all";
  if (!["all", "incomplete", "complete", "rejected"].includes(status)) {
    return invalidParam("status must be all, incomplete, complete, or rejected.", favoriteQuery);
  }

  const dateFrom = parseDateOnly(values.dateFrom, "dateFrom");
  if (!dateFrom.ok) {
    return invalidParam(dateFrom.detail, favoriteQuery);
  }
  const dateTo = parseDateOnly(values.dateTo, "dateTo");
  if (!dateTo.ok) {
    return invalidParam(dateTo.detail, favoriteQuery);
  }
  if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
    return invalidParam("dateFrom must be on or before dateTo.", favoriteQuery);
  }

  const page = parsePositiveInteger(values.page, "page", 1);
  if (!page.ok) {
    return invalidParam(page.detail, favoriteQuery);
  }

  const pageSize = parsePositiveInteger(values.pageSize, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (!pageSize.ok) {
    return invalidParam(pageSize.detail, favoriteQuery);
  }

  const offset = (page.value - 1) * pageSize.value;
  if (!Number.isSafeInteger(offset)) {
    return invalidParam("page and pageSize produce an unsafe offset.", favoriteQuery);
  }

  return {
    ok: true,
    value: {
      q,
      normalizedQuery: normalizeText(q),
      sort: sort as VersionListSort,
      status: status as VersionListStatus,
      page: page.value,
      pageSize: pageSize.value,
      offset,
      favoriteVersionIds,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      dateFromUtc: dateFrom.value ? jstDateStartAsUtc(dateFrom.value) : null,
      dateToExclusiveUtc: dateTo.value ? jstDateEndExclusiveAsUtc(dateTo.value) : null
    }
  };
}

function parseGetParams(url: URL): ParseResult {
  return parseCommonParams({
    q: url.searchParams.get("q"),
    sort: url.searchParams.get("sort"),
    status: url.searchParams.get("status"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize")
  }, null, false);
}

function parseFavoriteVersionIds(value: unknown): { ok: true; value: string[] } | { ok: false; detail: string } {
  if (!Array.isArray(value)) {
    return { ok: false, detail: "favoriteVersionIds must be an array." };
  }

  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const rawId of value) {
    if (typeof rawId !== "string") {
      return { ok: false, detail: "favoriteVersionIds must contain only strings." };
    }

    const versionId = rawId.trim();
    if (!versionId || versionId.length > MAX_VERSION_ID_LENGTH) {
      return { ok: false, detail: `Each favorite version ID must be 1-${MAX_VERSION_ID_LENGTH} characters.` };
    }
    if (!seen.has(versionId)) {
      seen.add(versionId);
      uniqueIds.push(versionId);
      if (uniqueIds.length > MAX_FAVORITE_VERSION_IDS) {
        return { ok: false, detail: `favoriteVersionIds must contain ${MAX_FAVORITE_VERSION_IDS} unique items or less.` };
      }
    }
  }

  return { ok: true, value: uniqueIds };
}

async function parsePostParams(request: Request): Promise<ParseResult> {
  let body: VersionListBody;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalidParam("Request body must be a JSON object.", true);
    }
    body = parsed as VersionListBody;
  } catch {
    return invalidParam("Request body must be valid JSON.", true);
  }

  const favoriteVersionIds = parseFavoriteVersionIds(body.favoriteVersionIds);
  if (!favoriteVersionIds.ok) {
    return invalidParam(favoriteVersionIds.detail, true);
  }

  return parseCommonParams({
    q: body.q,
    sort: body.sort,
    status: body.status,
    dateFrom: body.dateFrom,
    dateTo: body.dateTo,
    page: body.page,
    pageSize: body.pageSize
  }, favoriteVersionIds.value, true);
}

function buildVersionFilter(params: VersionListParams): { sql: string; bindings: Array<string | number> } {
  const conditions = [...PUBLIC_VERSION_CONDITIONS];
  const bindings: Array<string | number> = [];

  if (params.status === "incomplete") {
    conditions.push("versions.progress < 100", "versions.is_rejected = 0");
  } else if (params.status === "complete") {
    conditions.push("versions.progress = 100", "versions.is_rejected = 0");
  } else if (params.status === "rejected") {
    conditions.push("versions.is_rejected = 1");
  }

  const dateColumn = params.sort === "updated" ? "charts.updated_at" : "versions.created_at";
  if (params.dateFromUtc) {
    conditions.push(`${dateColumn} >= ?`);
    bindings.push(params.dateFromUtc);
  }
  if (params.dateToExclusiveUtc) {
    conditions.push(`${dateColumn} < ?`);
    bindings.push(params.dateToExclusiveUtc);
  }

  if (params.q) {
    conditions.push(`(
      instr(songs.normalized_title, ?) > 0
      OR instr(songs.normalized_subtitle, ?) > 0
      OR instr(songs.normalized_artist, ?) > 0
      OR instr(songs.normalized_subartist, ?) > 0
      OR instr(COALESCE(versions.normalized_chart_name, charts.normalized_chart_name), ?) > 0
      OR instr(lower(versions.author), lower(?)) > 0
    )`);
    bindings.push(
      params.normalizedQuery,
      params.normalizedQuery,
      params.normalizedQuery,
      params.normalizedQuery,
      params.normalizedQuery,
      params.q
    );
  }

  if (params.favoriteVersionIds !== null) {
    conditions.push("versions.id IN (SELECT value FROM json_each(?))");
    bindings.push(JSON.stringify(params.favoriteVersionIds));
  }

  return { sql: conditions.join("\n      AND "), bindings };
}

function buildOrderBy(sort: VersionListSort): string {
  return sort === "updated"
    ? "charts.updated_at DESC, versions.created_at DESC, versions.id DESC"
    : "versions.created_at DESC, versions.id DESC";
}

function branchSegmentToNumber(segment: string): string {
  const normalized = segment.trim().toLowerCase();
  if (!/^[a-z]+$/.test(normalized)) {
    return normalized;
  }

  let value = 0;
  for (const char of normalized) {
    value = (value * 26) + (char.charCodeAt(0) - 96);
  }
  return String(value);
}

function buildVersionPathLabel(branchPath: string): string {
  const segments = branchPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment.toLowerCase() !== "root");
  return segments.length === 0 ? "BASE" : segments.map(branchSegmentToNumber).join("-");
}

function buildCommentPreview(comment: string | null): { commentPreview: string; hasComment: boolean } {
  const normalized = String(comment ?? "").trim().replace(/\s+/gu, " ");
  const codePoints = Array.from(normalized);
  if (codePoints.length === 0) {
    return { commentPreview: "", hasComment: false };
  }
  return {
    commentPreview: codePoints.length > MAX_COMMENT_PREVIEW_CODE_POINTS
      ? `${codePoints.slice(0, MAX_COMMENT_PREVIEW_CODE_POINTS).join("")}…`
      : normalized,
    hasComment: true
  };
}

function mapVersionRow(row: VersionListRow) {
  const comment = buildCommentPreview(row.comment);
  return {
    versionId: row.version_id,
    chartId: row.chart_id,
    createdAt: row.version_created_at,
    chartCreatedAt: row.chart_created_at,
    chartUpdatedAt: row.chart_updated_at,
    rootCreatedAt: row.chart_created_at,
    title: row.song_title,
    subtitle: row.song_subtitle,
    artist: row.song_artist,
    subartist: row.song_subartist,
    chartName: row.chart_name,
    difficulty: row.difficulty || row.level || null,
    author: row.author,
    ...comment,
    progress: row.progress,
    isRejected: row.is_rejected === 1,
    withdrawn: row.withdrawn_at !== null || row.download_block_reason === "withdrawn",
    deleteRequested: row.delete_requested_at !== null || row.download_block_reason === "delete_requested",
    downloadBlocked: row.download_blocked === 1,
    branchPath: row.branch_path,
    versionLabel: buildVersionPathLabel(row.branch_path),
    isNew: row.is_new === 1,
    newUntil: row.new_until
  };
}

async function selectVersionList(env: Env, params: VersionListParams): Promise<{
  items: ReturnType<typeof mapVersionRow>[];
  total: number;
  serverTime: string;
}> {
  if (params.favoriteVersionIds !== null && params.favoriteVersionIds.length === 0) {
    const clock = await env.DB.prepare("SELECT CURRENT_TIMESTAMP AS server_time").first<{ server_time: string }>();
    return { items: [], total: 0, serverTime: clock?.server_time ?? new Date().toISOString() };
  }

  const filter = buildVersionFilter(params);
  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS total, CURRENT_TIMESTAMP AS server_time
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    INNER JOIN songs ON songs.id = charts.song_id
    WHERE ${filter.sql}
  `).bind(...filter.bindings).first<CountRow>();

  const rows = await env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.chart_id AS chart_id,
      versions.created_at AS version_created_at,
      charts.created_at AS chart_created_at,
      charts.updated_at AS chart_updated_at,
      songs.title AS song_title,
      songs.subtitle AS song_subtitle,
      songs.artist AS song_artist,
      songs.subartist AS song_subartist,
      COALESCE(versions.chart_name, charts.chart_name) AS chart_name,
      versions.difficulty AS difficulty,
      versions.level AS level,
      versions.author AS author,
      versions.comment AS comment,
      versions.progress AS progress,
      versions.is_rejected AS is_rejected,
      versions.withdrawn_at AS withdrawn_at,
      versions.delete_requested_at AS delete_requested_at,
      versions.download_blocked AS download_blocked,
      versions.download_block_reason AS download_block_reason,
      versions.branch_path AS branch_path,
      datetime(charts.created_at, '+168 hours') AS new_until,
      CASE WHEN CURRENT_TIMESTAMP < datetime(charts.created_at, '+168 hours') THEN 1 ELSE 0 END AS is_new
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    INNER JOIN songs ON songs.id = charts.song_id
    WHERE ${filter.sql}
    ORDER BY ${buildOrderBy(params.sort)}
    LIMIT ? OFFSET ?
  `).bind(...filter.bindings, params.pageSize, params.offset).all<VersionListRow>();

  return {
    items: (rows.results ?? []).map(mapVersionRow),
    total: Number(countRow?.total ?? 0),
    serverTime: countRow?.server_time ?? new Date().toISOString()
  };
}

async function countUnavailableFavorites(env: Env, favoriteVersionIds: string[]): Promise<number> {
  if (favoriteVersionIds.length === 0) {
    return 0;
  }

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE ${PUBLIC_VERSION_CONDITIONS.join("\n      AND ")}
      AND versions.id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(favoriteVersionIds)).first<{ total: number }>();
  return Math.max(0, favoriteVersionIds.length - Number(row?.total ?? 0));
}

async function handleVersionList(request: Request, env: Env, favoriteQuery: boolean): Promise<Response> {
  const parsed = favoriteQuery
    ? await parsePostParams(request)
    : parseGetParams(new URL(request.url));
  if (!parsed.ok) {
    const failure = parsed.failure;
    return apiError(request, env, failure.status, failure.code, failure.message, failure.detail);
  }

  const params = parsed.value;
  try {
    const result = await selectVersionList(env, params);
    const unavailableFavoriteCount = params.favoriteVersionIds === null
      ? undefined
      : await countUnavailableFavorites(env, params.favoriteVersionIds);
    const responseBody: Record<string, unknown> = {
      items: result.items,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total: result.total,
        hasNext: params.offset + result.items.length < result.total
      },
      serverTime: result.serverTime
    };
    if (unavailableFavoriteCount !== undefined) {
      responseBody.unavailableFavoriteCount = unavailableFavoriteCount;
    }

    return ok(request, env, responseBody, favoriteQuery
      ? { headers: { "Cache-Control": "no-store" } }
      : undefined);
  } catch (error) {
    console.error("[version-list-d1-read] failed to read version list", {
      code: "VERSION_LIST_QUERY_FAILED",
      route: favoriteQuery ? "/api/versions/query" : "/api/versions",
      sort: params.sort,
      status: params.status,
      page: params.page,
      pageSize: params.pageSize,
      favoriteCount: params.favoriteVersionIds?.length ?? 0,
      hasDateFrom: params.dateFrom !== null,
      hasDateTo: params.dateTo !== null,
      errorType: error instanceof Error ? error.name : typeof error
    });
    return apiError(
      request,
      env,
      500,
      "VERSION_LIST_QUERY_FAILED",
      "投稿一覧の取得に失敗しました。",
      "Version list query failed."
    );
  }
}

export function handlePublicVersionListRoute(
  request: Request,
  env: Env,
  favoriteQuery: boolean
): Promise<Response> | Response {
  if ((!favoriteQuery && request.method !== "GET") || (favoriteQuery && request.method !== "POST")) {
    return methodNotAllowed(request, env, request.method);
  }
  return handleVersionList(request, env, favoriteQuery);
}
