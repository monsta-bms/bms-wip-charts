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

export function errorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

export function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Vary": "Origin"
  });

  const origin = getRequestOrigin(request);
  const allowedOrigin = getAllowedOrigin(env);

  if (!origin || !isCorsAllowed(request, env)) {
    return headers;
  }

  headers.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
  headers.set("Access-Control-Allow-Methods", allowedMethods);
  headers.set("Access-Control-Allow-Headers", allowedHeaders);
  headers.set("Access-Control-Max-Age", "86400");

  return headers;
}

function buildJsonHeaders(request: Request, env: Env, initHeaders?: HeadersInit): Headers {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");

  if (initHeaders) {
    new Headers(initHeaders).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

export function buildResponseHeaders(request: Request, env: Env, initHeaders?: HeadersInit): Headers {
  const headers = corsHeaders(request, env);

  if (initHeaders) {
    new Headers(initHeaders).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

export function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  init: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: buildJsonHeaders(request, env, init.headers)
  });
}

export function fileResponse(
  request: Request,
  env: Env,
  body: BodyInit | null,
  init: ResponseInit = {}
): Response {
  return new Response(body, {
    ...init,
    headers: buildResponseHeaders(request, env, init.headers)
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
