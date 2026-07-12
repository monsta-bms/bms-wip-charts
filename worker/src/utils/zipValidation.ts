import {
  BlobReader,
  ERR_BAD_FORMAT,
  ERR_CENTRAL_DIRECTORY_NOT_FOUND,
  ERR_ENCRYPTED,
  ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND,
  ERR_EOCDR_NOT_FOUND,
  ERR_EXTRAFIELD_ZIP64_NOT_FOUND,
  ERR_INVALID_SIGNATURE,
  ERR_INVALID_UNCOMPRESSED_SIZE,
  ERR_LOCAL_FILE_HEADER_NOT_FOUND,
  ERR_OVERLAPPING_ENTRY,
  ERR_SPLIT_ZIP_FILE,
  ERR_UNSUPPORTED_COMPRESSION,
  ERR_UNSUPPORTED_ENCRYPTION,
  ERR_UNSUPPORTED_FORMAT,
  Uint8ArrayWriter,
  ZipReader,
  type FileEntry
} from "@zip.js/zip.js/index-native.js";
import { forbiddenAudioExtensions, SINGLE_CHART_MAX_BYTES } from "./fileValidation";

export const ZIP_MAX_ENTRIES = 160;
export const ZIP_MAX_FILES = 128;
export const ZIP_MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const ZIP_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
export const ZIP_MAX_DIRECTORY_DEPTH = 8;
export const ZIP_MAX_PATH_LENGTH = 240;
export const ZIP_MAX_ENTRY_COMPRESSION_RATIO = 100;
export const ZIP_MAX_TOTAL_COMPRESSION_RATIO = 50;

const ENTRY_RATIO_MIN_BYTES = 1024 * 1024;
const TOTAL_RATIO_MIN_BYTES = 2 * 1024 * 1024;
const ALLOWED_COMPRESSION_METHODS = new Set([0, 8]);
const CHART_EXTENSIONS = new Set([".bms", ".bme", ".bml"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".ini", ".cfg", ".csv", ".xml", ".def"]);
const NESTED_ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz"]);
const AUDIO_EXTENSIONS = new Set(forbiddenAudioExtensions);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const DRIVE_PATH_PATTERN = /^[a-z]:\//iu;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;

const KNOWN_INVALID_ZIP_ERRORS = new Set([
  ERR_BAD_FORMAT,
  ERR_CENTRAL_DIRECTORY_NOT_FOUND,
  ERR_ENCRYPTED,
  ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND,
  ERR_EOCDR_NOT_FOUND,
  ERR_EXTRAFIELD_ZIP64_NOT_FOUND,
  ERR_INVALID_SIGNATURE,
  ERR_INVALID_UNCOMPRESSED_SIZE,
  ERR_LOCAL_FILE_HEADER_NOT_FOUND,
  ERR_OVERLAPPING_ENTRY,
  ERR_SPLIT_ZIP_FILE,
  ERR_UNSUPPORTED_COMPRESSION,
  ERR_UNSUPPORTED_ENCRYPTION,
  ERR_UNSUPPORTED_FORMAT
]);

export type ZipInspectionSummary = {
  entryCount: number;
  fileCount: number;
  declaredUncompressedBytes: number;
  declaredCompressedBytes: number;
  chartFileCount: number;
};

export type ZipInspectionFailure = {
  code: string;
  message: string;
  detail: string;
  summary: ZipInspectionSummary;
};

export type ZipInspectionResult =
  | {
    ok: true;
    summary: ZipInspectionSummary;
    chart: {
      fileName: string;
      bytes: ArrayBuffer;
    };
  }
  | { ok: false; failure: ZipInspectionFailure };

function emptySummary(): ZipInspectionSummary {
  return {
    entryCount: 0,
    fileCount: 0,
    declaredUncompressedBytes: 0,
    declaredCompressedBytes: 0,
    chartFileCount: 0
  };
}

export function buildZipInspectionLogDetail(
  code: string,
  summary: Partial<ZipInspectionSummary> = {}
): string {
  return JSON.stringify({
    stage: "zip_inspection",
    errorCode: code,
    entryCount: summary.entryCount ?? null,
    declaredUncompressedBytes: summary.declaredUncompressedBytes ?? null,
    chartFileCount: summary.chartFileCount ?? null
  });
}

function rejectZip(
  code: string,
  message: string,
  summary: ZipInspectionSummary
): ZipInspectionResult {
  return {
    ok: false,
    failure: {
      code,
      message,
      detail: buildZipInspectionLogDetail(code, summary),
      summary: { ...summary }
    }
  };
}

function getFinalExtension(path: string): string {
  const baseName = path.split("/").pop() ?? "";
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex < 0 ? "" : baseName.slice(dotIndex).toLowerCase();
}

function normalizeEntryPath(filename: string):
  | { ok: true; path: string; depth: number }
  | { ok: false } {
  if (!filename || CONTROL_CHARACTER_PATTERN.test(filename)) {
    return { ok: false };
  }

  const normalized = filename.normalize("NFKC").replace(/\\/g, "/");
  if (
    normalized.length === 0
    || normalized.length > ZIP_MAX_PATH_LENGTH
    || normalized.startsWith("/")
    || normalized.startsWith("//")
    || DRIVE_PATH_PATTERN.test(normalized)
  ) {
    return { ok: false };
  }

  const pathWithoutDirectorySlash = normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
  const segments = pathWithoutDirectorySlash.split("/");
  if (
    segments.length === 0
    || segments.some((segment) => !segment || segment === "." || segment === ".." || /[ .]$/u.test(segment))
  ) {
    return { ok: false };
  }

  const depth = Math.max(0, segments.length - 1);
  if (depth > ZIP_MAX_DIRECTORY_DEPTH) {
    return { ok: false };
  }

  return {
    ok: true,
    path: segments.join("/").toLowerCase(),
    depth
  };
}

function isSupportedUnixEntryType(entry: FileEntry | { directory: true; unixMode?: number; unixExternalUpper?: number }): boolean {
  const mode = entry.unixMode ?? entry.unixExternalUpper ?? 0;
  const fileType = mode & UNIX_FILE_TYPE_MASK;
  if (fileType === 0) {
    return true;
  }

  return entry.directory ? fileType === UNIX_DIRECTORY : fileType === UNIX_REGULAR_FILE;
}

function isSafeIntegerSize(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isKnownInvalidZipError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (KNOWN_INVALID_ZIP_ERRORS.has(error.message)) {
    return true;
  }

  return /decompress|deflate|inflate|invalid (?:distance|data|format|header)|unexpected end/iu.test(error.message);
}

async function verifyNoOverlappingEntries(entries: FileEntry[]): Promise<void> {
  for (const entry of entries) {
    await entry.getData(
      new WritableStream<Uint8Array>(),
      { checkOverlappingEntryOnly: true }
    );
  }
}

async function extractChartEntry(entry: FileEntry): Promise<ArrayBuffer | null> {
  const bytes = await entry.getData(new Uint8ArrayWriter(), {
    checkSignature: true,
    checkOverlappingEntry: true
  });
  if (bytes.byteLength > SINGLE_CHART_MAX_BYTES || bytes.byteLength !== entry.uncompressedSize) {
    return null;
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function inspectZipUpload(file: File): Promise<ZipInspectionResult> {
  const summary = emptySummary();
  const reader = new ZipReader(new BlobReader(file), {
    useWebWorkers: false,
    useCompressionStream: true,
    extractAppendedData: true
  });
  const normalizedPaths = new Set<string>();
  const fileEntries: FileEntry[] = [];
  const chartEntries: FileEntry[] = [];
  let minimumEntryOffset = Number.POSITIVE_INFINITY;

  try {
    for await (const entry of reader.getEntriesGenerator()) {
      summary.entryCount += 1;
      minimumEntryOffset = Math.min(minimumEntryOffset, entry.offset);
      if (summary.entryCount > ZIP_MAX_ENTRIES) {
        return rejectZip("ZIP_TOO_MANY_ENTRIES", "ZIP内の項目数が上限を超えています。", summary);
      }

      const normalizedPath = normalizeEntryPath(entry.filename);
      if (!normalizedPath.ok) {
        return rejectZip("ZIP_UNSAFE_PATH", "ZIP内に安全でないパスが含まれています。", summary);
      }
      if (normalizedPaths.has(normalizedPath.path)) {
        return rejectZip("ZIP_DUPLICATE_PATH", "ZIP内に重複するパスが含まれています。", summary);
      }
      normalizedPaths.add(normalizedPath.path);

      if (entry.encrypted || entry.zipCrypto) {
        return rejectZip("ZIP_ENCRYPTED", "暗号化されたZIPは投稿できません。", summary);
      }
      if (!ALLOWED_COMPRESSION_METHODS.has(entry.compressionMethod)) {
        return rejectZip("ZIP_UNSUPPORTED_COMPRESSION", "対応していない圧縮方式が含まれています。", summary);
      }
      if (entry.zip64 || entry.version >= 45 || entry.diskNumberStart !== 0) {
        return rejectZip("ZIP_UNSUPPORTED_FORMAT", "この形式のZIPは投稿できません。", summary);
      }
      if (!isSafeIntegerSize(entry.compressedSize) || !isSafeIntegerSize(entry.uncompressedSize)) {
        return rejectZip("ZIP_INVALID", "ZIPを安全に読み取れませんでした。", summary);
      }
      if (!isSupportedUnixEntryType(entry)) {
        return rejectZip("ZIP_UNSUPPORTED_ENTRY_TYPE", "ZIP内に特殊なファイルが含まれています。", summary);
      }

      if (entry.directory) {
        continue;
      }

      summary.fileCount += 1;
      if (summary.fileCount > ZIP_MAX_FILES) {
        return rejectZip("ZIP_TOO_MANY_FILES", "ZIP内のファイル数が上限を超えています。", summary);
      }
      if (entry.uncompressedSize > ZIP_MAX_ENTRY_BYTES) {
        return rejectZip("ZIP_ENTRY_TOO_LARGE", "ZIP内のファイルサイズが上限を超えています。", summary);
      }
      if (entry.compressedSize === 0 && entry.uncompressedSize > 0) {
        return rejectZip("ZIP_INVALID", "ZIPを安全に読み取れませんでした。", summary);
      }

      summary.declaredCompressedBytes += entry.compressedSize;
      summary.declaredUncompressedBytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(summary.declaredCompressedBytes) || !Number.isSafeInteger(summary.declaredUncompressedBytes)) {
        return rejectZip("ZIP_INVALID", "ZIPを安全に読み取れませんでした。", summary);
      }
      if (summary.declaredUncompressedBytes > ZIP_MAX_UNCOMPRESSED_BYTES) {
        return rejectZip("ZIP_UNCOMPRESSED_TOO_LARGE", "ZIPの展開後容量が上限を超えています。", summary);
      }

      if (
        entry.uncompressedSize >= ENTRY_RATIO_MIN_BYTES
        && entry.uncompressedSize / entry.compressedSize > ZIP_MAX_ENTRY_COMPRESSION_RATIO
      ) {
        return rejectZip("ZIP_COMPRESSION_RATIO_TOO_HIGH", "ZIPの圧縮率が高すぎます。", summary);
      }

      const extension = getFinalExtension(normalizedPath.path);
      if (AUDIO_EXTENSIONS.has(extension)) {
        return rejectZip("ZIP_AUDIO_NOT_ALLOWED", "音声ファイルを含むZIPは投稿できません。", summary);
      }
      if (NESTED_ARCHIVE_EXTENSIONS.has(extension)) {
        return rejectZip("ZIP_NESTED_ARCHIVE", "別のアーカイブを含むZIPは投稿できません。", summary);
      }
      if (CHART_EXTENSIONS.has(extension)) {
        if (entry.uncompressedSize > SINGLE_CHART_MAX_BYTES) {
          return rejectZip("ZIP_CHART_TOO_LARGE", "ZIP内の譜面ファイルが上限を超えています。", summary);
        }
        chartEntries.push(entry);
        summary.chartFileCount = chartEntries.length;
      } else if (!IMAGE_EXTENSIONS.has(extension) && !TEXT_EXTENSIONS.has(extension)) {
        return rejectZip("ZIP_FORBIDDEN_FILE", "ZIP内に許可されていないファイルが含まれています。", summary);
      }

      fileEntries.push(entry);
    }

    if ((summary.entryCount > 0 && minimumEntryOffset !== 0) || (reader.appendedData?.length ?? 0) > 0) {
      return rejectZip("ZIP_UNSUPPORTED_FORMAT", "この形式のZIPは投稿できません。", summary);
    }
    if (
      summary.declaredUncompressedBytes >= TOTAL_RATIO_MIN_BYTES
      && (
        summary.declaredCompressedBytes === 0
        || summary.declaredUncompressedBytes / summary.declaredCompressedBytes > ZIP_MAX_TOTAL_COMPRESSION_RATIO
      )
    ) {
      return rejectZip("ZIP_COMPRESSION_RATIO_TOO_HIGH", "ZIP全体の圧縮率が高すぎます。", summary);
    }
    if (chartEntries.length === 0) {
      return rejectZip("ZIP_CHART_NOT_FOUND", "ZIP内に譜面ファイルが見つかりません。", summary);
    }
    if (chartEntries.length !== 1) {
      return rejectZip("ZIP_MULTIPLE_CHART_FILES", "ZIP内の譜面ファイルは1件だけにしてください。", summary);
    }

    await verifyNoOverlappingEntries(fileEntries);
    const chartBytes = await extractChartEntry(chartEntries[0]);
    if (!chartBytes) {
      return rejectZip("ZIP_CHART_TOO_LARGE", "ZIP内の譜面ファイルが上限を超えています。", summary);
    }

    return {
      ok: true,
      summary,
      chart: {
        fileName: chartEntries[0].filename,
        bytes: chartBytes
      }
    };
  } catch (error) {
    if (isKnownInvalidZipError(error)) {
      return rejectZip("ZIP_INVALID", "ZIPを安全に読み取れませんでした。", summary);
    }
    throw error;
  } finally {
    await reader.close().catch(() => undefined);
  }
}
