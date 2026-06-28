import { apiError, Env, methodNotAllowed, ok } from "../utils/response";

export function handleFileRoute(request: Request, env: Env, fileId: string): Response {
  if (!fileId) {
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

  return ok(request, env, {
    fileId,
    downloadUrl: null,
    mode: "stub",
    message: "R2 download is not implemented in Phase 9."
  });
}
