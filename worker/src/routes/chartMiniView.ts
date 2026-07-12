import type { BmsMiniViewPayload, StoredBmsMiniView } from "../utils/bmsMiniView";
import { sha256HexFromBuffer } from "../utils/hash";
import {
  apiError,
  buildResponseHeaders,
  Env,
  errorDetail,
  methodNotAllowed,
  ok
} from "../utils/response";

type MiniViewRow = {
  measure_notes_json: string | null;
};

function readStoredMiniView(value: string | null): StoredBmsMiniView | null {
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as {
    schemaVersion?: unknown;
    miniView?: StoredBmsMiniView;
  };
  if (parsed.schemaVersion !== 3 || !parsed.miniView) {
    return null;
  }
  return parsed.miniView;
}

function isPayload(value: unknown): value is BmsMiniViewPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<BmsMiniViewPayload>;
  return payload.schemaVersion === 1
    && payload.mode === "7key-sp"
    && Number.isInteger(payload.resolution)
    && Number(payload.resolution) > 0
    && Array.isArray(payload.laneOrder)
    && Array.isArray(payload.tapBits)
    && Array.isArray(payload.longActiveBits)
    && Array.isArray(payload.longStartBits)
    && Array.isArray(payload.longEndBits)
    && typeof payload.measureBits === "string"
    && (
      payload.measurePositions === undefined
      || (Array.isArray(payload.measurePositions) && payload.measurePositions.every(Number.isInteger))
    );
}

async function buildEtag(payload: BmsMiniViewPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = await sha256HexFromBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return `"miniview-${hash}"`;
}

export async function handleChartMiniViewRoute(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }

  let row: MiniViewRow | null;
  try {
    row = await env.DB.prepare(`
      SELECT versions.measure_notes_json AS measure_notes_json
      FROM versions
      INNER JOIN charts ON charts.id = versions.chart_id
      WHERE versions.id = ?
        AND COALESCE(versions.is_hidden, 0) = 0
        AND COALESCE(charts.is_hidden, 0) = 0
      LIMIT 1
    `).bind(versionId).first<MiniViewRow>();
  } catch (error) {
    console.error("[chart-miniview] failed to read stored miniview", {
      code: "MINIVIEW_READ_FAILED",
      versionId,
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "MINIVIEW_READ_FAILED",
      "譜面ミニビューを読み込めませんでした。",
      "Failed to read chart miniview data."
    );
  }

  if (!row) {
    return apiError(
      request,
      env,
      404,
      "MINIVIEW_NOT_AVAILABLE",
      "譜面ミニビューは利用できません。",
      "The version does not exist or is not public."
    );
  }

  let stored: StoredBmsMiniView | null;
  try {
    stored = readStoredMiniView(row.measure_notes_json);
  } catch (error) {
    console.error("[chart-miniview] stored miniview JSON is invalid", {
      code: "MINIVIEW_READ_FAILED",
      versionId,
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "MINIVIEW_READ_FAILED",
      "譜面ミニビューを読み込めませんでした。",
      "Stored chart miniview JSON is invalid."
    );
  }

  if (!stored || stored.status !== "ready" || stored.mode !== "7key-sp" || !isPayload(stored.payload)) {
    return apiError(
      request,
      env,
      404,
      "MINIVIEW_NOT_AVAILABLE",
      "譜面ミニビューは利用できません。",
      "This version has no supported chart miniview payload."
    );
  }

  const etag = await buildEtag(stored.payload);
  const cacheHeaders = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
    ETag: etag
  };
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: buildResponseHeaders(request, env, cacheHeaders)
    });
  }

  return ok(request, env, {
    versionId,
    miniView: stored.payload
  }, { headers: cacheHeaders });
}
