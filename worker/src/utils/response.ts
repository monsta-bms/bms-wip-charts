export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ALLOWED_ORIGIN?: string;
  HASH_SECRET?: string;
  ADMIN_TOKEN?: string;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  detail: string;
};

const allowedMethods = "GET,POST,OPTIONS";
const allowedHeaders = "Content-Type,Authorization";

function getAllowedOrigin(env: Env): string {
  return env.ALLOWED_ORIGIN?.trim() ?? "";
}

function getRequestOrigin(request: Request): string {
  return request.headers.get("Origin") ?? "";
}

export function isCorsAllowed(request: Request, env: Env): boolean {
  const origin = getRequestOrigin(request);
  if (!origin) {
    return true;
  }

  const allowedOrigin = getAllowedOrigin(env);
  if (!allowedOrigin) {
    return false;
  }

  return allowedOrigin === "*" || allowedOrigin === origin;
}

export function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = getRequestOrigin(request);
  const allowedOrigin = getAllowedOrigin(env);
  const accessControlAllowOrigin = allowedOrigin === "*" ? "*" : origin;

  if (!origin || !isCorsAllowed(request, env)) {
    return {
      "Vary": "Origin"
    };
  }

  return {
    "Access-Control-Allow-Origin": accessControlAllowOrigin,
    "Access-Control-Allow-Methods": allowedMethods,
    "Access-Control-Allow-Headers": allowedHeaders,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  init: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
      ...(init.headers ?? {})
    }
  });
}

export function ok(
  request: Request,
  env: Env,
  body: unknown,
  init: ResponseInit = {}
): Response {
  return jsonResponse(request, env, body, {
    status: 200,
    ...init
  });
}

export function apiError(
  request: Request,
  env: Env,
  status: number,
  code: string,
  message: string,
  detail: string
): Response {
  const body: ApiErrorBody = { code, message, detail };
  return jsonResponse(request, env, body, { status });
}

export function optionsResponse(request: Request, env: Env): Response {
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

  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env)
  });
}

export function methodNotAllowed(request: Request, env: Env, method: string): Response {
  return apiError(
    request,
    env,
    405,
    "METHOD_NOT_ALLOWED",
    "許可されていないHTTPメソッドです。",
    `${method} はこのAPIでは使用できません。`
  );
}

export function notFound(request: Request, env: Env): Response {
  return apiError(
    request,
    env,
    404,
    "NOT_FOUND",
    "APIが見つかりません。",
    "指定されたパスに対応するAPIはありません。"
  );
}
