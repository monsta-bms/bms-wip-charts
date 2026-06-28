import { apiError, Env, methodNotAllowed, ok } from "../utils/response";

export function handleChartsRoute(request: Request, env: Env): Response {
  if (request.method === "GET") {
    return ok(request, env, {
      charts: [],
      mode: "stub",
      message: "D1 read is not implemented in Phase 9."
    });
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
