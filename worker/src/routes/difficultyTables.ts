import { sha256Hex } from "../utils/hash";
import {
  buildDifficultyTableViewModel,
  DifficultyTableViewModel
} from "../utils/difficultyTableDisplay";
import { normalizeOriginUrl } from "../utils/originUrl";
import { Env } from "../utils/response";
import {
  buildVersionAuthorHistoryMap,
  selectVersionAuthorHistory
} from "../utils/versionAuthorHistory";
import { difficultyTableWithdrawalExclusionSql } from "../utils/versionWithdrawal";

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
type ImportTheme = "white" | "default" | "dark";

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
  parent_version_id: string | null;
  branch_path: string;
  author: string;
  difficulty: string | null;
  title: string;
  subtitle: string;
  artist: string;
  subartist: string;
  md5: string;
  file_id: string;
  comment: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  chart_name: string;
  origin_url: string | null;
  source_title: string | null;
  source_subtitle: string | null;
  source_artist: string | null;
  source_subartist: string | null;
  source_metadata_encoding: string | null;
  source_metadata_status: string | null;
  source_metadata_updated_at: string | null;
};

type ClassifiedDifficultyTableRow = {
  row: DifficultyTableRow;
  classification: DifficultyClassification;
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
      versions.parent_version_id AS parent_version_id,
      versions.branch_path AS branch_path,
      versions.author AS author,
      versions.difficulty AS difficulty,
      versions.title AS title,
      versions.subtitle AS subtitle,
      versions.artist AS artist,
      versions.subartist AS subartist,
      versions.md5 AS md5,
      versions.file_id AS file_id,
      versions.comment AS comment,
      versions.completed_at AS completed_at,
      versions.created_at AS created_at,
      versions.updated_at AS updated_at,
      COALESCE(versions.chart_name, charts.chart_name) AS chart_name,
      versions.origin_url AS origin_url,
      version_source_metadata.source_title AS source_title,
      version_source_metadata.source_subtitle AS source_subtitle,
      version_source_metadata.source_artist AS source_artist,
      version_source_metadata.source_subartist AS source_subartist,
      version_source_metadata.encoding AS source_metadata_encoding,
      version_source_metadata.status AS source_metadata_status,
      version_source_metadata.updated_at AS source_metadata_updated_at
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    LEFT JOIN version_source_metadata
      ON version_source_metadata.version_id = versions.id
    WHERE versions.progress = 100
      AND versions.completed_at IS NOT NULL
      AND COALESCE(versions.is_hidden, 0) = 0
      AND COALESCE(charts.is_hidden, 0) = 0
      AND COALESCE(versions.download_blocked, 0) = 0
      AND COALESCE(versions.withdrawal_download_blocked, 0) = 0
      AND versions.file_deleted_at IS NULL
      AND versions.withdrawn_at IS NULL
      AND versions.delete_requested_at IS NULL
      AND ${difficultyTableWithdrawalExclusionSql("versions")}
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

function selectRowsForTable(
  tableId: DifficultyTableId,
  rows: DifficultyTableRow[]
): ClassifiedDifficultyTableRow[] {
  return deduplicateRowsByMd5(rows).flatMap((row) => {
    const classification = classifyDifficulty(row.difficulty);
    return classification?.tableId === tableId ? [{ row, classification }] : [];
  });
}

function buildTableData(
  request: Request,
  table: DifficultyTableDefinition,
  rows: ClassifiedDifficultyTableRow[],
  authorHistories: Map<string, string[]>
): Array<Record<string, string | null>> {
  return rows.map(({ row, classification }) => {
    const versionLabel = buildVersionPathLabel(row.branch_path);
    const originUrl = normalizeOriginUrl(row.origin_url);
    const normalizedOriginUrl = originUrl.ok ? originUrl.value : null;
    const viewModel: DifficultyTableViewModel = buildDifficultyTableViewModel({
      versionId: row.version_id,
      md5: row.md5.toLowerCase(),
      level: classification.level,
      levelLabel: `${table.symbol}${classification.level}`,
      originalDifficulty: classification.originalDifficulty,
      storedTitle: row.title,
      storedSubtitle: row.subtitle,
      storedArtist: row.artist,
      storedSubartist: row.subartist,
      sourceMetadataStatus: row.source_metadata_status,
      sourceTitle: row.source_title,
      sourceSubtitle: row.source_subtitle,
      sourceArtist: row.source_artist,
      sourceSubartist: row.source_subartist,
      chartName: row.chart_name,
      versionLabel,
      chainAuthors: authorHistories.get(row.version_id) ?? [row.author],
      postComment: row.comment,
      originUrl: normalizedOriginUrl,
      downloadUrl: buildAbsoluteUrl(request, `/api/files/${encodeURIComponent(row.file_id)}`),
      completedAt: row.completed_at,
      versionUpdatedAt: row.updated_at,
      sourceMetadataUpdatedAt: row.source_metadata_updated_at
    });
    return {
      md5: row.md5.toLowerCase(),
      level: classification.level,
      title: row.title,
      artist: row.artist,
      url_diff: viewModel.downloadUrl,
      ...(viewModel.originUrl ? { url: viewModel.originUrl } : {}),
      name_diff: `${row.chart_name} / ${versionLabel}`,
      bms_wip_original_difficulty: classification.originalDifficulty,
      bms_wip_chart_name: row.chart_name,
      bms_wip_version: versionLabel,
      bms_wip_author: row.author,
      bms_wip_completed_at: row.completed_at,
      bms_wip_subtitle: row.subtitle,
      bms_wip_subartist: row.subartist,
      comment: viewModel.comment,
      bms_wip_display_title: viewModel.displayTitle,
      bms_wip_display_artist: viewModel.displayArtist,
      bms_wip_authors: viewModel.authorsText,
      ...(viewModel.sourceTitle !== null ? { bms_wip_source_title: viewModel.sourceTitle } : {}),
      ...(viewModel.sourceSubtitle !== null ? { bms_wip_source_subtitle: viewModel.sourceSubtitle } : {}),
      ...(viewModel.sourceArtist !== null ? { bms_wip_source_artist: viewModel.sourceArtist } : {}),
      ...(viewModel.sourceSubartist !== null ? { bms_wip_source_subartist: viewModel.sourceSubartist } : {})
    };
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

function getImportTheme(request: Request): ImportTheme {
  const theme = new URL(request.url).searchParams.get("theme");
  return theme === "white" || theme === "dark" ? theme : "default";
}

function getImportThemeStyle(theme: ImportTheme): string {
  const palettes: Record<ImportTheme, {
    background: string;
    surface: string;
    text: string;
    muted: string;
    line: string;
    link: string;
  }> = {
    white: {
      background: "#f7f9fa",
      surface: "#ffffff",
      text: "#18221f",
      muted: "#5a6864",
      line: "#cfd8d5",
      link: "#195443"
    },
    default: {
      background: "#e4e9e7",
      surface: "#f0f3f2",
      text: "#1d2926",
      muted: "#52635e",
      line: "#aab9b4",
      link: "#155241"
    },
    dark: {
      background: "#101613",
      surface: "#18211e",
      text: "#e5eeea",
      muted: "#a8b7b1",
      line: "#3b4e47",
      link: "#63b99b"
    }
  };
  const palette = palettes[theme];
  return `:root{color-scheme:${theme === "dark" ? "dark" : "light"}}body{box-sizing:border-box;margin:0;min-height:100vh;padding:clamp(24px,6vw,72px);background:${palette.background};color:${palette.text};font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{box-sizing:border-box;margin:0 auto;max-width:680px;padding:clamp(20px,5vw,40px);background:${palette.surface};border:1px solid ${palette.line};border-radius:6px}h1{margin:0 0 12px;font-size:clamp(1.35rem,4vw,2rem)}p{margin:0;color:${palette.muted}}a{color:${palette.link};font-weight:700;text-underline-offset:.2em}a:focus-visible{outline:3px solid ${palette.link};outline-offset:3px}`;
}

function buildImportHtml(request: Request, table: DifficultyTableDefinition): string {
  const headerUrl = buildAbsoluteUrl(request, `${API_PATH_PREFIX}${table.id}/header.json`);
  const theme = getImportTheme(request);
  return `<!doctype html>
<html lang="ja" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="bmstable" content="${escapeHtml(headerUrl)}">
  <title>${escapeHtml(table.name)}</title>
  <style>${getImportThemeStyle(theme)}</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(table.name)}</h1>
    <p><a href="${escapeHtml(headerUrl)}">header.json</a></p>
  </main>
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
    const selectedRows = selectRowsForTable(table.id, rows);
    const selectedVersionIds = selectedRows.map(({ row }) => row.version_id);
    const authorRows = await selectVersionAuthorHistory(env.DB, selectedVersionIds);
    const authorHistories = buildVersionAuthorHistoryMap(selectedVersionIds, authorRows);
    const data = buildTableData(request, table, selectedRows, authorHistories);
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
