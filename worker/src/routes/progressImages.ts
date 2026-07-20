import { sha256HexFromBuffer } from "../utils/hash";
import {
  apiError,
  Env,
  errorDetail,
  fileResponse,
  jsonResponse,
  methodNotAllowed
} from "../utils/response";

const MAX_PROGRESS_IMAGE_BYTES = 1024 * 1024;

type ApiFailure = {
  status: number;
  code: string;
  message: string;
  detail: string;
};

type FormDataReadableRequest = {
  headers: {
    get(name: string): string | null;
  };
  formData(): Promise<FormData>;
};

export type ProgressImageUpload = {
  bytes: ArrayBuffer;
  mime: "image/png";
  size: number;
  sha256: string;
};

export type StoredProgressImage = {
  key: string;
  mime: "image/png";
  size: number;
  sha256: string;
  createdAt: string;
};

type ProgressImageRow = {
  version_id: string;
  progress_image_key: string | null;
  progress_image_mime: string | null;
  progress_image_size: number | null;
  progress_image_sha256: string | null;
  progress_image_created_at: string | null;
};

type ProgressImageFetchRow = ProgressImageRow & {
  version_is_hidden: number;
  chart_is_hidden: number;
  lifecycle_status: string | null;
};

function isFormFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value;
}

function safeR2Part(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_") || "unknown";
}

function buildProgressImageKey(chartId: string, versionId: string): string {
  return `charts/${safeR2Part(chartId)}/versions/${safeR2Part(versionId)}/progress/progress.png`;
}

function makeProgressImageFailure(
  status: number,
  code: string,
  message: string,
  detail: string
): ApiFailure {
  return { status, code, message, detail };
}

export function buildProgressImageObject(versionId: string, row: ProgressImageRow | StoredProgressImage | null) {
  if (!row) {
    return null;
  }

  const key = "key" in row ? row.key : row.progress_image_key;
  if (!key) {
    return null;
  }

  const mime = "mime" in row ? row.mime : row.progress_image_mime;
  const size = "size" in row ? row.size : row.progress_image_size;
  const sha256 = "sha256" in row ? row.sha256 : row.progress_image_sha256;
  const createdAt = "createdAt" in row ? row.createdAt : row.progress_image_created_at;

  return {
    url: `/api/progress-images/${encodeURIComponent(versionId)}`,
    mime: mime || "image/png",
    size: size ?? null,
    sha256: sha256 || null,
    createdAt: createdAt || null
  };
}

export async function parseOptionalProgressImage(
  request: FormDataReadableRequest
): Promise<{ ok: true; value: ProgressImageUpload | null } | { ok: false; failure: ApiFailure }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return { ok: true, value: null };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    console.error("[progress-image-form-parse] failed to parse multipart form", {
      code: "INVALID_FORM",
      message: errorDetail(error)
    });
    return {
      ok: false,
      failure: makeProgressImageFailure(
        400,
        "INVALID_FORM",
        "投稿フォームが不正です。",
        `Failed to parse multipart/form-data while reading progressImage: ${errorDetail(error)}`
      )
    };
  }

  const value = form.get("progressImage");
  if (value === null) {
    return { ok: true, value: null };
  }

  if (!isFormFile(value)) {
    return {
      ok: false,
      failure: makeProgressImageFailure(
        400,
        "INVALID_PROGRESS_IMAGE",
        "進捗画像が不正です。",
        "progressImage must be an image/png file part."
      )
    };
  }

  if (value.type.toLowerCase() !== "image/png") {
    return {
      ok: false,
      failure: makeProgressImageFailure(
        400,
        "INVALID_PROGRESS_IMAGE",
        "進捗画像はPNGのみ送信できます。",
        `progressImage MIME must be image/png, received ${value.type || "empty"}.`
      )
    };
  }

  if (value.size <= 0) {
    return {
      ok: false,
      failure: makeProgressImageFailure(
        400,
        "INVALID_PROGRESS_IMAGE",
        "進捗画像が空です。",
        "progressImage file size must be greater than 0 bytes."
      )
    };
  }

  if (value.size > MAX_PROGRESS_IMAGE_BYTES) {
    return {
      ok: false,
      failure: makeProgressImageFailure(
        400,
        "PROGRESS_IMAGE_TOO_LARGE",
        "進捗画像のサイズが上限を超えています。",
        `progressImage must be ${MAX_PROGRESS_IMAGE_BYTES} bytes or less.`
      )
    };
  }

  const bytes = await value.arrayBuffer();
  if (bytes.byteLength <= 0) {
    return {
      ok: false,
      failure: makeProgressImageFailure(
        400,
        "INVALID_PROGRESS_IMAGE",
        "進捗画像が空です。",
        "progressImage decoded byte length must be greater than 0 bytes."
      )
    };
  }

  return {
    ok: true,
    value: {
      bytes,
      mime: "image/png",
      size: bytes.byteLength,
      sha256: await sha256HexFromBuffer(bytes)
    }
  };
}

export async function storeProgressImageForVersion(
  env: Env,
  chartId: string,
  versionId: string,
  image: ProgressImageUpload
): Promise<StoredProgressImage> {
  const record: StoredProgressImage = {
    key: buildProgressImageKey(chartId, versionId),
    mime: "image/png",
    size: image.size,
    sha256: image.sha256,
    createdAt: new Date().toISOString()
  };

  await env.FILES.put(record.key, image.bytes, {
    httpMetadata: {
      contentType: record.mime
    },
    customMetadata: {
      chartId,
      versionId,
      progressImageSha256: record.sha256
    }
  });

  try {
    const result = await env.DB.prepare(`
      UPDATE versions
      SET
        progress_image_key = ?,
        progress_image_mime = ?,
        progress_image_size = ?,
        progress_image_sha256 = ?,
        progress_image_created_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND chart_id = ?
    `).bind(
      record.key,
      record.mime,
      record.size,
      record.sha256,
      record.createdAt,
      versionId,
      chartId
    ).run();

    if (result.meta?.changes === 0) {
      throw new Error(`No version row was updated for versionId=${versionId}.`);
    }
  } catch (error) {
    try {
      await env.FILES.delete(record.key);
    } catch (cleanupError) {
      console.error("[progress-image-r2-cleanup] failed to delete progress image after DB update failure", {
        code: "PROGRESS_IMAGE_CLEANUP_FAILED",
        chartId,
        versionId,
        r2Key: record.key,
        dbMessage: errorDetail(error),
        cleanupMessage: errorDetail(cleanupError)
      });
    }
    throw error;
  }

  return record;
}

async function appendProgressImagePostLogDetail(
  env: Env,
  versionId: string,
  detail: string
): Promise<void> {
  await env.DB.prepare(`
    UPDATE post_logs
    SET detail = COALESCE(detail, '') || ?
    WHERE version_id = ?
      AND result = 'accepted'
  `).bind(detail, versionId).run();
}

async function selectProgressImageRows(env: Env, versionIds: string[]): Promise<ProgressImageRow[]> {
  const rows: ProgressImageRow[] = [];
  const chunkSize = 90;

  for (let offset = 0; offset < versionIds.length; offset += chunkSize) {
    const chunk = versionIds.slice(offset, offset + chunkSize);
    if (chunk.length === 0) {
      continue;
    }

    const placeholders = chunk.map(() => "?").join(", ");
    const result = await env.DB.prepare(`
      SELECT
        id AS version_id,
        progress_image_key,
        progress_image_mime,
        progress_image_size,
        progress_image_sha256,
        progress_image_created_at
      FROM versions
      WHERE id IN (${placeholders})
        AND progress_image_key IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM version_withdrawals AS lifecycle
          WHERE lifecycle.version_id = versions.id
            AND lifecycle.status IN ('processing', 'tombstoned', 'deleted')
        )
    `).bind(...chunk).all<ProgressImageRow>();

    rows.push(...(result.results ?? []));
  }

  return rows;
}

export async function addProgressImagesToChartsResponse(
  request: Request,
  env: Env,
  response: Response
): Promise<Response> {
  if (!response.ok) {
    return response;
  }

  let body: any;
  try {
    body = await response.clone().json();
  } catch (error) {
    console.error("[charts-progress-image-response-parse] failed to parse charts response", {
      code: "PROGRESS_IMAGE_RESPONSE_PARSE_FAILED",
      message: errorDetail(error)
    });
    return response;
  }

  const versionIds: string[] = [];
  for (const chartEntry of Array.isArray(body?.charts) ? body.charts : []) {
    for (const version of Array.isArray(chartEntry?.versions) ? chartEntry.versions : []) {
      if (typeof version?.id === "string") {
        versionIds.push(version.id);
        version.progressImage = null;
      }
    }
  }

  if (versionIds.length === 0) {
    return jsonResponse(request, env, body, { status: response.status });
  }

  try {
    const rows = await selectProgressImageRows(env, versionIds);
    const rowByVersionId = new Map(rows.map((row) => [row.version_id, row]));

    for (const chartEntry of body.charts) {
      for (const version of chartEntry.versions) {
        version.progressImage = buildProgressImageObject(version.id, rowByVersionId.get(version.id) ?? null);
      }
    }
  } catch (error) {
    console.error("[charts-progress-image-read] failed to read progress image metadata", {
      code: "D1_QUERY_FAILED",
      message: errorDetail(error)
    });

    return apiError(
      request,
      env,
      500,
      "D1_QUERY_FAILED",
      "投稿一覧の取得に失敗しました。",
      `D1 read failed in charts-progress-image-read: ${errorDetail(error)}`
    );
  }

  return jsonResponse(request, env, body, { status: response.status });
}

export async function attachProgressImageAfterPostSuccess(
  request: Request,
  env: Env,
  response: Response,
  image: ProgressImageUpload | null
): Promise<Response> {
  if (!image || !response.ok) {
    return response;
  }

  let body: any;
  try {
    body = await response.clone().json();
  } catch (error) {
    console.error("[progress-image-success-response-parse] failed to parse post response", {
      code: "PROGRESS_IMAGE_RESPONSE_PARSE_FAILED",
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "PROGRESS_IMAGE_UPLOAD_FAILED",
      "進捗画像の保存に失敗しました。",
      "Could not read created version id from successful post response."
    );
  }

  const chartId = typeof body?.chartId === "string" ? body.chartId : "";
  const versionId = typeof body?.versionId === "string" ? body.versionId : "";
  if (!chartId || !versionId) {
    return apiError(
      request,
      env,
      500,
      "PROGRESS_IMAGE_UPLOAD_FAILED",
      "進捗画像の保存に失敗しました。",
      "Successful post response did not include chartId and versionId."
    );
  }

  try {
    const stored = await storeProgressImageForVersion(env, chartId, versionId, image);
    body.progressImage = buildProgressImageObject(versionId, stored);

    try {
      await appendProgressImagePostLogDetail(
        env,
        versionId,
        `; progressImageUploaded=true; progressImageKey=${stored.key}; progressImageSize=${stored.size}; progressImageSha256=${stored.sha256}`
      );
    } catch (logError) {
      console.error("[progress-image-post-log-update] failed to update accepted post log", {
        code: "POST_LOG_WRITE_FAILED",
        chartId,
        versionId,
        message: errorDetail(logError)
      });
    }

    return jsonResponse(request, env, body, { status: response.status });
  } catch (error) {
    console.error("[progress-image-upload] failed to persist progress image", {
      code: "PROGRESS_IMAGE_UPLOAD_FAILED",
      chartId,
      versionId,
      size: image.size,
      sha256: image.sha256,
      message: errorDetail(error)
    });

    try {
      await appendProgressImagePostLogDetail(
        env,
        versionId,
        `; progressImageUploaded=false; progressImageError=${errorDetail(error)}`
      );
    } catch (logError) {
      console.error("[progress-image-post-log-update] failed to update failed progress image log", {
        code: "POST_LOG_WRITE_FAILED",
        chartId,
        versionId,
        message: errorDetail(logError)
      });
    }

    return apiError(
      request,
      env,
      500,
      "PROGRESS_IMAGE_UPLOAD_FAILED",
      "進捗画像の保存に失敗しました。",
      `Progress image persistence failed after version creation: ${errorDetail(error)}`
    );
  }
}

async function selectProgressImageFetchRow(env: Env, versionId: string): Promise<ProgressImageFetchRow | null> {
  return env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.progress_image_key AS progress_image_key,
      versions.progress_image_mime AS progress_image_mime,
      versions.progress_image_size AS progress_image_size,
      versions.progress_image_sha256 AS progress_image_sha256,
      versions.progress_image_created_at AS progress_image_created_at,
      versions.is_hidden AS version_is_hidden,
      charts.is_hidden AS chart_is_hidden,
      (
        SELECT lifecycle.status
        FROM version_withdrawals AS lifecycle
        WHERE lifecycle.version_id = versions.id
        ORDER BY lifecycle.requested_at DESC, lifecycle.id DESC
        LIMIT 1
      ) AS lifecycle_status
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<ProgressImageFetchRow>();
}

export async function handleProgressImageRoute(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }

  if (!versionId) {
    return apiError(
      request,
      env,
      400,
      "INVALID_VERSION_ID",
      "進捗画像IDが不正です。",
      "versionId path parameter is empty."
    );
  }

  let row: ProgressImageFetchRow | null;
  try {
    row = await selectProgressImageFetchRow(env, versionId);
  } catch (error) {
    console.error("[progress-image-d1-read] failed to read progress image metadata", {
      code: "D1_QUERY_FAILED",
      versionId,
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "D1_QUERY_FAILED",
      "進捗画像情報の取得に失敗しました。",
      `D1 read failed in progress-image-d1-read: ${errorDetail(error)}`
    );
  }

  if (!row) {
    return apiError(
      request,
      env,
      404,
      "PROGRESS_IMAGE_NOT_FOUND",
      "進捗画像が見つかりません。",
      "The version does not exist."
    );
  }

  if (["processing", "tombstoned", "deleted"].includes(row.lifecycle_status || "")) {
    return apiError(
      request,
      env,
      404,
      "PROGRESS_IMAGE_NOT_FOUND",
      "この投稿のファイルは公開されていません。",
      "The progress image is not public."
    );
  }

  if (!row.progress_image_key) {
    return apiError(
      request,
      env,
      404,
      "PROGRESS_IMAGE_NOT_FOUND",
      "進捗画像が見つかりません。",
      `No progress image is registered for versionId=${versionId}.`
    );
  }

  if (row.version_is_hidden === 1 || row.chart_is_hidden === 1) {
    return apiError(
      request,
      env,
      403,
      "PROGRESS_IMAGE_UNAVAILABLE",
      "この進捗画像は表示できません。",
      "The version or chart is hidden."
    );
  }

  let object: R2ObjectBody | null;
  try {
    object = await env.FILES.get(row.progress_image_key);
  } catch (error) {
    console.error("[progress-image-r2-read] failed to read progress image from R2", {
      code: "R2_DOWNLOAD_FAILED",
      versionId,
      r2Key: row.progress_image_key,
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "R2_DOWNLOAD_FAILED",
      "進捗画像の取得に失敗しました。",
      `R2 read failed: ${errorDetail(error)}`
    );
  }

  if (!object) {
    return apiError(
      request,
      env,
      404,
      "PROGRESS_IMAGE_R2_NOT_FOUND",
      "進捗画像ファイルが見つかりません。",
      `R2 object does not exist: ${row.progress_image_key}`
    );
  }

  const headers = new Headers({
    "Content-Type": row.progress_image_mime || "image/png",
    "Cache-Control": "public, max-age=300"
  });
  if (row.progress_image_size !== null) {
    headers.set("Content-Length", String(row.progress_image_size));
  }

  return fileResponse(request, env, object.body, { headers });
}
