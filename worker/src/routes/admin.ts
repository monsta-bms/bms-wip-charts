import { apiError, Env, methodNotAllowed, ok } from "../utils/response";

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) {
    console.error("[admin-auth] ADMIN_TOKEN secret is not configured", {
      code: "CONFIG_MISSING",
      target: "ADMIN_TOKEN"
    });

    return apiError(
      request,
      env,
      500,
      "CONFIG_MISSING",
      "管理者認証の設定が不足しています。",
      "ADMIN_TOKEN secret is not configured."
    );
  }

  const token = getBearerToken(request);
  if (token !== env.ADMIN_TOKEN) {
    return apiError(
      request,
      env,
      401,
      "ADMIN_AUTH_REQUIRED",
      "管理者認証が必要です。",
      "Authorization header must be Bearer token for admin APIs."
    );
  }

  return null;
}

export function handleAdminRoute(request: Request, env: Env, action: string): Response {
  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }

  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  if (action === "hide-version") {
    return ok(request, env, {
      hidden: false,
      mode: "stub",
      message: "Version hiding is not implemented in Phase 9."
    });
  }

  if (action === "ban") {
    return ok(request, env, {
      banned: false,
      mode: "stub",
      message: "Ban registration is not implemented in Phase 9."
    });
  }

  return apiError(
    request,
    env,
    404,
    "ADMIN_ROUTE_NOT_FOUND",
    "管理APIが見つかりません。",
    `Unknown admin action: ${action}`
  );
}
