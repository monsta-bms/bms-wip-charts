import { apiError, Env, errorDetail, fileResponse, methodNotAllowed } from "../utils/response";

type FileRow = {
  version_id: string;
  chart_id: string;
  file_id: string;
  file_name: string;
  file_size: number;
  file_sha256: string;
  r2_key: string;
  version_is_hidden: number;
  version_hidden_reason: string | null;
  download_blocked: number;
  download_block_reason: string | null;
  chart_is_hidden: number;
  chart_hidden_reason: string | null;
};

function toBoolean(value: number): boolean {
  return value === 1;
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }

  return fileName.slice(dotIndex).toLowerCase();
}

function getContentType(fileName: string): string {
  const extension = getFileExtension(fileName);
  if ([".bms", ".bme", ".bml"].includes(extension)) {
    return "text/plain; charset=utf-8";
  }

  if (extension === ".zip") {
    return "application/zip";
  }

  return "application/octet-stream";
}

function escapeFallbackFileName(fileName: string): string {
  const escaped = fileName
    .replace(/[\\/\x00-\x1f\x7f]+/g, "_")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/"/g, "'")
    .slice(0, 160)
    .trim();

  return escaped || "download";
}

function buildContentDisposition(fileName: string): string {
  const fallbackName = escapeFallbackFileName(fileName);
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function selectFileRow(env: Env, fileId: string): Promise<FileRow | null> {
  return env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.chart_id AS chart_id,
      versions.file_id AS file_id,
      versions.file_name AS file_name,
      versions.file_size AS file_size,
      versions.file_sha256 AS file_sha256,
      versions.r2_key AS r2_key,
      versions.is_hidden AS version_is_hidden,
      versions.hidden_reason AS version_hidden_reason,
      versions.download_blocked AS download_blocked,
      versions.download_block_reason AS download_block_reason,
      charts.is_hidden AS chart_is_hidden,
      charts.hidden_reason AS chart_hidden_reason
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.file_id = ?
    LIMIT 1
  `).bind(fileId).first<FileRow>();
}

export async function handleFileRoute(request: Request, env: Env, fileId: string): Promise<Response> {
  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return apiError(
      request,
      env,
      400,
      "INVALID_FILE_ID",
      "ファイルIDが不正です。",
      "fileId path parameter is empty."
    );
  }

  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }

  let fileRow: FileRow | null;
  try {
    fileRow = await selectFileRow(env, normalizedFileId);
  } catch (error) {
    console.error("[file-d1-lookup] failed to lookup file metadata from D1", {
      code: "D1_QUERY_FAILED",
      fileId: normalizedFileId,
      message: errorDetail(error)
    });

    return apiError(
      request,
      env,
      500,
      "D1_QUERY_FAILED",
      "ファイル情報の取得に失敗しました。",
      `D1 file lookup failed in file-d1-lookup: ${errorDetail(error)}`
    );
  }

  if (!fileRow) {
    return apiError(
      request,
      env,
      404,
      "FILE_NOT_FOUND",
      "ファイルが見つかりません。",
      "No version exists for the requested fileId."
    );
  }

  if (toBoolean(fileRow.chart_is_hidden)) {
    return apiError(
      request,
      env,
      403,
      "FILE_NOT_AVAILABLE",
      "このファイルは現在利用できません。",
      `The parent chart is hidden. reason=${fileRow.chart_hidden_reason ?? "none"}`
    );
  }

  if (toBoolean(fileRow.version_is_hidden)) {
    return apiError(
      request,
      env,
      403,
      "FILE_NOT_AVAILABLE",
      "このファイルは現在利用できません。",
      `The version is hidden. reason=${fileRow.version_hidden_reason ?? "none"}`
    );
  }

  if (toBoolean(fileRow.download_blocked)) {
    return apiError(
      request,
      env,
      403,
      "FILE_DOWNLOAD_BLOCKED",
      "このファイルはダウンロードできません。",
      `Download is blocked. reason=${fileRow.download_block_reason ?? "unknown"}`
    );
  }

  let object: R2ObjectBody | null;
  try {
    object = await env.FILES.get(fileRow.r2_key);
  } catch (error) {
    console.error("[file-r2-download] failed to download file from R2", {
      code: "R2_DOWNLOAD_FAILED",
      fileId: normalizedFileId,
      versionId: fileRow.version_id,
      r2Key: fileRow.r2_key,
      message: errorDetail(error)
    });

    return apiError(
      request,
      env,
      500,
      "R2_DOWNLOAD_FAILED",
      "ファイルの取得に失敗しました。",
      `R2 get failed in file-r2-download: ${errorDetail(error)}`
    );
  }

  if (!object) {
    return apiError(
      request,
      env,
      404,
      "R2_FILE_NOT_FOUND",
      "保存済みファイルが見つかりません。",
      "D1 metadata exists, but the R2 object for r2_key was not found."
    );
  }

  return fileResponse(request, env, object.body, {
    status: 200,
    headers: {
      "Content-Type": getContentType(fileRow.file_name),
      "Content-Disposition": buildContentDisposition(fileRow.file_name),
      "Content-Length": String(fileRow.file_size),
      "X-Content-Type-Options": "nosniff",
      "ETag": object.httpEtag,
      "Cache-Control": "private, max-age=0, no-store"
    }
  });
}
