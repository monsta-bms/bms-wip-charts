// 5 MiB ZIP + 1 MiB progress image + 2 MiB for up to 5000 progress-map
// blocks, other text fields, and multipart framing.
// Individual file limits remain enforced by their existing validators.
export const MAX_MULTIPART_UPLOAD_BYTES = 8 * 1024 * 1024;

type MultipartFailure = {
  status: number;
  code: string;
  message: string;
  detail: string;
};

export type MultipartUploadResult =
  | { ok: true; form: FormData }
  | { ok: false; failure: MultipartFailure };

function tooLarge(): MultipartUploadResult {
  return {
    ok: false,
    failure: {
      status: 413,
      code: "REQUEST_TOO_LARGE",
      message: "投稿全体のサイズが上限を超えています。",
      detail: `The complete multipart request must be ${MAX_MULTIPART_UPLOAD_BYTES} bytes or less.`
    }
  };
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    console.warn("[multipart-body-cancel] failed to cancel rejected upload stream", {
      code: "UPLOAD_STREAM_CANCEL_FAILED"
    });
  }
}

// Read and count the original stream before invoking a multipart parser. Do not
// clone/tee it: an unread tee branch would retain the entire upload in memory.
export async function parseMultipartUpload(request: Request): Promise<MultipartUploadResult> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿フォームが不正です。",
        detail: "Content-Type must be multipart/form-data."
      }
    };
  }

  if (!request.body || request.bodyUsed || request.body.locked) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿フォームが不正です。",
        detail: "The multipart request body is missing or has already been consumed."
      }
    };
  }
  const reader = request.body.getReader();

  const declaredLength = request.headers.get("Content-Length") ?? "";
  if (/^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_MULTIPART_UPLOAD_BYTES) {
    await cancelReader(reader);
    reader.releaseLock();
    return tooLarge();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let bytes: ArrayBuffer;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MULTIPART_UPLOAD_BYTES) {
        await cancelReader(reader);
        return tooLarge();
      }
      chunks.push(value);
    }
    bytes = new ArrayBuffer(total);
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } catch (error) {
    await cancelReader(reader);
    console.error("[multipart-body-read] failed to read upload stream", {
      code: "INVALID_FORM",
      errorType: error instanceof Error ? error.name : typeof error
    });
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿フォームが不正です。",
        detail: "Failed to read the multipart request body."
      }
    };
  } finally {
    chunks.length = 0;
    reader.releaseLock();
  }

  try {
    const form = await new Response(bytes, {
      headers: { "Content-Type": contentType }
    }).formData();
    return { ok: true, form };
  } catch (error) {
    console.error("[multipart-form-parse] failed to parse bounded upload", {
      code: "INVALID_FORM",
      errorType: error instanceof Error ? error.name : typeof error
    });
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_FORM",
        message: "投稿フォームが不正です。",
        detail: "Failed to parse multipart/form-data."
      }
    };
  }
}
