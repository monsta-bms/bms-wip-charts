export const SINGLE_CHART_MAX_BYTES = 2 * 1024 * 1024;
export const ZIP_MAX_BYTES = 5 * 1024 * 1024;

export const forbiddenAudioExtensions = [
  ".wav",
  ".ogg",
  ".mp3",
  ".flac",
  ".aac",
  ".m4a",
  ".aiff",
  ".aif"
];

const allowedExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);
const bmsTextExtensions = new Set([".bms", ".bme", ".bml"]);

export type FileValidationResult =
  | {
      ok: true;
      extension: string;
      isBmsText: boolean;
      maxBytes: number;
    }
  | {
      ok: false;
      code: "INVALID_EXTENSION" | "FILE_TOO_LARGE";
      message: string;
      detail: string;
    };

export function getFileExtension(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? "";
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }

  return baseName.slice(dotIndex).toLowerCase();
}

export function sanitizeFileName(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop()?.trim() || "upload";
  return baseName.replace(/[\\/\x00-\x1f\x7f]+/g, "_").slice(0, 160) || "upload";
}

export function validateUploadFile(file: File): FileValidationResult {
  const extension = getFileExtension(file.name);
  if (!allowedExtensions.has(extension)) {
    return {
      ok: false,
      code: "INVALID_EXTENSION",
      message: "投稿できないファイル形式です。",
      detail: "Allowed extensions are .bms, .bme, .bml, and .zip. Audio files must not be uploaded."
    };
  }

  const isBmsText = bmsTextExtensions.has(extension);
  const maxBytes = isBmsText ? SINGLE_CHART_MAX_BYTES : ZIP_MAX_BYTES;
  if (file.size > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "ファイルサイズが上限を超えています。",
      detail: isBmsText
        ? "Single BMS/BME/BML files must be 2MB or smaller."
        : "ZIP files must be 5MB or smaller."
    };
  }

  // TODO: Inspect ZIP entries and reject forbidden audio extensions before accepting production uploads.
  return {
    ok: true,
    extension,
    isBmsText,
    maxBytes
  };
}
