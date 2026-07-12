import { sha256Hex } from "../utils/hash";
import { Env } from "../utils/response";

const TABLE_PATH_PREFIX = "/difficulty-tables/";
const API_PATH_PREFIX = "/api/difficulty-tables/";
const HEADER_CACHE_SECONDS = 60 * 60;
const DATA_CACHE_SECONDS = 60;

const RC_STAR_LEVEL_ORDER = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "他"
];
const RC_DOUBLE_STAR_LEVEL_ORDER = ["1", "2", "3", "4", "5", "6", "7"];
const SL_TO_RC_STAR_LEVEL = new Map<number, string>([
  [0, "0"],
  [1, "1"],
  [2, "3"],
  [3, "5"],
  [4, "6"],
  [5, "8"],
  [6, "10"],
  [7, "12"],
  [8, "14"],
  [9, "15"],
  [10, "17"],
  [11, "18"],
  [12, "19"]
]);

type DifficultyTableId = "rc-star" | "rc-double-star";
type DifficultyTableResource = "import" | "header" | "data";

type DifficultyTableDefinition = {
  id: DifficultyTableId;
  name: string;
  symbol: string;
  levelOrder: string[];
};

type DifficultyClassification = {
  tableId: DifficultyTableId;
  level: string;
  originalDifficulty: string;
};

type DifficultyTableRow = {
  version_id: string;
  branch_path: string;
  author: string;
  difficulty: string | null;
  title: string;
  subtitle: string;
  artist: string;
  subartist: string;
  md5: string;
  file_id: string;
  completed_at: string | null;
  created_at: string;
  chart_name: string;
};

type ParsedDifficultyTablePath = {
  tableId: string;
  resource: DifficultyTableResource;
};

const TABLES: Record<DifficultyTableId, DifficultyTableDefinition> = {
  "rc-star": {
    id: "rc-star",
    name: "リサイクルセンター RC★",
    symbol: "RC★",
    levelOrder: RC_STAR_LEVEL_ORDER
  },
  "rc-double-star": {
    id: "rc-double-star",
    name: "リサイクルセンター RC★★",
    symbol: "RC★★",
    levelOrder: RC_DOUBLE_STAR_LEVEL_ORDER
  }
};

function isDifficultyTableId(value: string): value is DifficultyTableId {
  return value === "rc-star" || value === "rc-double-star";
}

function parseDifficultyTablePath(path: string): ParsedDifficultyTablePath | null {
  if (path.startsWith(API_PATH_PREFIX)) {
    const segments = path.slice(API_PATH_PREFIX.length).split("/").filter(Boolean);
    if (segments.length !== 2) {
      return null;
    }

    if (segments[1] === "header.json") {
      return { tableId: segments[0], resource: "header" };
    }
    if (segments[1] === "data.json") {
      return { tableId: segments[0], resource: "data" };
    }
    return null;
  }

  if (path.startsWith(TABLE_PATH_PREFIX)) {
    const segments = path.slice(TABLE_PATH_PREFIX.length).split("/").filter(Boolean);
    if (segments.length === 1) {
      return { tableId: segments[0], resource: "import" };
    }
  }

  return null;
}

export function isDifficultyTablePath(path: string): boolean {
  return path.startsWith(API_PATH_PREFIX) || path.startsWith(TABLE_PATH_PREFIX);
}

function publicHeaders(contentType: string, cacheSeconds: number): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": `public, max-age=${cacheSeconds}, must-revalidate`,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff"
  });
}

function publicError(request: Request, status: number, code: string, message: string): Response {
  const body = JSON.stringify({ code, message });
  const headers = publicHeaders("application/json; charset=utf-8", 0);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Length", String(new TextEncoder().encode(body).byteLength));
  if (status === 405) {
    headers.set("Allow", "GET, HEAD, OPTIONS");
  }
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}

function publicOptionsResponse(): Response {
  const headers = publicHeaders("text/plain; charset=utf-8", 0);
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 204, headers });
}

function matchesEtag(request: Request, etag: string): boolean {
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (!ifNoneMatch) {
    return false;
  }
  return ifNoneMatch.split(",").some((value) => {
    const candidate = value.trim();
    return candidate === "*" || candidate === etag;
  });
}

async function contentResponse(
  request: Request,
  content: string,
  contentType: string,
  cacheSeconds: number
): Promise<Response> {
  const etag = `"${await sha256Hex(content)}"`;
  const headers = publicHeaders(contentType, cacheSeconds);
  headers.set("ETag", etag);
  headers.set("Content-Length", String(new TextEncoder().encode(content).byteLength));

  if (matchesEtag(request, etag)) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === "HEAD" ? null : content, { status: 200, headers });
}

function normalizeDifficulty(value: string | null): string {
  return (value ?? "").normalize("NFKC").trim();
}

export function classifyDifficulty(value: string | null): DifficultyClassification | null {
  const originalDifficulty = normalizeDifficulty(value);
  if (!originalDifficulty) {
    return null;
  }

  const doubleStar = originalDifficulty.match(/^★★(\d+)$/u);
  if (doubleStar) {
    const level = Number(doubleStar[1]);
    if (Number.isSafeInteger(level) && level >= 1 && level <= 7) {
      return { tableId: "rc-double-star", level: String(level), originalDifficulty };
    }
    return { tableId: "rc-star", level: "他", originalDifficulty };
  }

  const star = originalDifficulty.match(/^★(\d+)$/u);
  if (star) {
    const level = Number(star[1]);
    if (Number.isSafeInteger(level) && level >= 0 && level <= 20) {
      return { tableId: "rc-star", level: String(level), originalDifficulty };
    }
    if (Number.isSafeInteger(level) && level >= 21 && level <= 25) {
      return { tableId: "rc-double-star", level: String(level - 20), originalDifficulty };
    }
    return { tableId: "rc-star", level: "他", originalDifficulty };
  }

  const satellite = originalDifficulty.match(/^sl(\d+)$/i);
  if (satellite) {
    const level = Number(satellite[1]);
    const mappedLevel = SL_TO_RC_STAR_LEVEL.get(level);
    return {
      tableId: "rc-star",
      level: mappedLevel ?? "他",
      originalDifficulty
    };
  }

  const stella = originalDifficulty.match(/^st(\d+)$/i);
  if (stella) {
    const level = Number(stella[1]);
    if (level === 0) {
      return { tableId: "rc-star", level: "20", originalDifficulty };
    }
    if (level >= 1 && level <= 3) {
      return { tableId: "rc-double-star", level: String(level), originalDifficulty };
    }
    if (level >= 4 && level <= 6) {
      return { tableId: "rc-double-star", level: "4", originalDifficulty };
    }
    if (level >= 7 && level <= 9) {
      return { tableId: "rc-double-star", level: "5", originalDifficulty };
    }
    if (level >= 10 && level <= 12) {
      return { tableId: "rc-double-star", level: "6", originalDifficulty };
    }
    if (level >= 13) {
      return { tableId: "rc-double-star", level: "7", originalDifficulty };
    }
  }

  return { tableId: "rc-star", level: "他", originalDifficulty };
}

function branchSegmentToNumber(segment: string): number | null {
  if (!/^[a-z]+$/i.test(segment)) {
    return null;
  }
  let value = 0;
  for (const character of segment.toLowerCase()) {
    value = value * 26 + character.charCodeAt(0) - 96;
  }
  return value;
}

function buildVersionPathLabel(branchPath: string): string {
  const segments = branchPath.split("/").filter((segment) => segment && segment !== "root");
  if (segments.length === 0) {
    return "BASE";
  }
  return segments.map((segment) => branchSegmentToNumber(segment) ?? segment).join("-");
}

function buildAbsoluteUrl(request: Request, path: string): string {
  return new URL(path, request.url).toString();
}

function isValidMd5(md5: string): boolean {
  return /^[0-9a-f]{32}$/i.test(md5);
}

async function selectEligibleRows(env: Env): Promise<DifficultyTableRow[]> {
  const result = await env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.branch_path AS branch_path,
      versions.author AS author,
      versions.difficulty AS difficulty,
      versions.title AS title,
      versions.subtitle AS subtitle,
      versions.artist AS artist,
      versions.subartist AS subartist,
      versions.md5 AS md5,
      versions.file_id AS file_id,
      versions.completed_at AS completed_at,
      versions.created_at AS created_at,
      charts.chart_name AS chart_name
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.progress = 100
      AND COALESCE(versions.is_hidden, 0) = 0
      AND COALESCE(charts.is_hidden, 0) = 0
      AND COALESCE(versions.download_blocked, 0) = 0
      AND versions.file_deleted_at IS NULL
      AND versions.withdrawn_at IS NULL
      AND versions.delete_requested_at IS NULL
      AND COALESCE(versions.is_rejected, 0) = 0
      AND COALESCE(versions.collapsed_by_completion, 0) = 0
      AND versions.md5 IS NOT NULL
      AND length(versions.md5) = 32
    ORDER BY
      datetime(versions.completed_at) DESC,
      datetime(versions.created_at) DESC,
      versions.id DESC
  `).all<DifficultyTableRow>();
  return result.results ?? [];
}

function deduplicateRowsByMd5(rows: DifficultyTableRow[]): DifficultyTableRow[] {
  const seen = new Set<string>();
  const uniqueRows: DifficultyTableRow[] = [];
  for (const row of rows) {
    const md5 = row.md5.toLowerCase();
    if (!isValidMd5(md5) || seen.has(md5)) {
      continue;
    }
    seen.add(md5);
    uniqueRows.push(row);
  }
  return uniqueRows;
}

function buildTableData(
  request: Request,
  tableId: DifficultyTableId,
  rows: DifficultyTableRow[]
): Array<Record<string, string | null>> {
  return deduplicateRowsByMd5(rows).flatMap((row) => {
    const classification = classifyDifficulty(row.difficulty);
    if (!classification || classification.tableId !== tableId) {
      return [];
    }

    const versionLabel = buildVersionPathLabel(row.branch_path);
    return [{
      md5: row.md5.toLowerCase(),
      level: classification.level,
      title: row.title,
      artist: row.artist,
      url_diff: buildAbsoluteUrl(request, `/api/files/${encodeURIComponent(row.file_id)}`),
      name_diff: `${row.chart_name} / ${versionLabel}`,
      bms_wip_original_difficulty: classification.originalDifficulty,
      bms_wip_chart_name: row.chart_name,
      bms_wip_version: versionLabel,
      bms_wip_author: row.author,
      bms_wip_completed_at: row.completed_at,
      bms_wip_subtitle: row.subtitle,
      bms_wip_subartist: row.subartist
    }];
  });
}

function buildHeader(request: Request, table: DifficultyTableDefinition): Record<string, unknown> {
  return {
    name: table.name,
    symbol: table.symbol,
    data_url: buildAbsoluteUrl(request, `${API_PATH_PREFIX}${table.id}/data.json`),
    level_order: table.levelOrder
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function buildImportHtml(request: Request, table: DifficultyTableDefinition): string {
  const headerUrl = buildAbsoluteUrl(request, `${API_PATH_PREFIX}${table.id}/header.json`);
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="bmstable" content="${escapeHtml(headerUrl)}">
  <title>${escapeHtml(table.name)}</title>
</head>
<body>
  <h1>${escapeHtml(table.name)}</h1>
  <p><a href="${escapeHtml(headerUrl)}">header.json</a></p>
</body>
</html>`;
}

export async function handleDifficultyTableRoute(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return publicOptionsResponse();
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return publicError(request, 405, "METHOD_NOT_ALLOWED", "GETまたはHEADを使用してください。");
  }

  const parsedPath = parseDifficultyTablePath(path);
  if (!parsedPath || !isDifficultyTableId(parsedPath.tableId)) {
    return publicError(request, 400, "INVALID_DIFFICULTY_TABLE", "難易度表の指定が不正です。");
  }
  const table = TABLES[parsedPath.tableId];

  if (parsedPath.resource === "import") {
    return contentResponse(
      request,
      buildImportHtml(request, table),
      "text/html; charset=utf-8",
      HEADER_CACHE_SECONDS
    );
  }

  if (parsedPath.resource === "header") {
    return contentResponse(
      request,
      JSON.stringify(buildHeader(request, table), null, 2),
      "application/json; charset=utf-8",
      HEADER_CACHE_SECONDS
    );
  }

  try {
    const rows = await selectEligibleRows(env);
    const data = buildTableData(request, table.id, rows);
    return contentResponse(
      request,
      JSON.stringify(data, null, 2),
      "application/json; charset=utf-8",
      DATA_CACHE_SECONDS
    );
  } catch (error) {
    console.error("[difficulty-table-list] failed to build difficulty table", {
      code: "DIFFICULTY_TABLE_UNAVAILABLE",
      tableId: table.id,
      message: error instanceof Error ? error.message : String(error)
    });
    return publicError(request, 503, "DIFFICULTY_TABLE_UNAVAILABLE", "難易度表を取得できませんでした。");
  }
}
