import { handleAdminRoute } from "./routes/admin";
import { handleChartsRoute, handleChartVersionsRoute } from "./routes/charts";
import { handleFileRoute } from "./routes/files";
import {
  apiError,
  Env,
  isCorsAllowed,
  methodNotAllowed,
  notFound,
  ok,
  optionsResponse
} from "./utils/response";

function handleHealth(request: Request, env: Env): Response {
  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }

  return ok(request, env, {
    status: "ok",
    service: "bms-wip-charts-worker",
    phase: "phase-9",
    bindings: {
      db: Boolean(env.DB),
      files: Boolean(env.FILES),
      allowedOrigin: Boolean(env.ALLOWED_ORIGIN),
      hashSecret: Boolean(env.HASH_SECRET),
      adminToken: Boolean(env.ADMIN_TOKEN)
    }
  });
}

function routeRequest(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return optionsResponse(request, env);
  }

  if (!isCorsAllowed(request, env)) {
    return apiError(
      request,
      env,
      403,
      "CORS_ORIGIN_NOT_ALLOWED",
      "許可されていないOriginです。",
      "ALLOWED_ORIGINとリクエストOriginが一致しません。"
    );
  }

  if (path === "/api/health") {
    return handleHealth(request, env);
  }

  if (path === "/api/charts") {
    return handleChartsRoute(request, env);
  }

  const versionMatch = path.match(/^\/api\/charts\/([^/]+)\/versions$/);
  if (versionMatch) {
    return handleChartVersionsRoute(request, env, decodeURIComponent(versionMatch[1]));
  }

  const fileMatch = path.match(/^\/api\/files\/([^/]+)$/);
  if (fileMatch) {
    return handleFileRoute(request, env, decodeURIComponent(fileMatch[1]));
  }

  const adminMatch = path.match(/^\/api\/admin\/([^/]+)$/);
  if (adminMatch) {
    return handleAdminRoute(request, env, decodeURIComponent(adminMatch[1]));
  }

  return notFound(request, env);
}

export default {
  fetch(request: Request, env: Env): Response {
    try {
      return routeRequest(request, env);
    } catch (error) {
      const url = new URL(request.url);
      console.error("[request-dispatch] unhandled Worker error", {
        code: "INTERNAL_ERROR",
        path: url.pathname,
        message: error instanceof Error ? error.message : String(error)
      });

      return apiError(
        request,
        env,
        500,
        "INTERNAL_ERROR",
        "予期しないエラーが発生しました。",
        "Unhandled exception in Worker request dispatch."
      );
    }
  }
};
