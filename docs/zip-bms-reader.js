(() => {
  const chartExtensions = new Set([".bms", ".bme", ".bml"]);
  const maxChartBytes = 2 * 1024 * 1024;
  const maxEntries = 160;
  const helperUrl = document.currentScript?.src || document.baseURI;
  const libraryUrl = new URL("./vendor/zip.min.js", helperUrl).href;
  let libraryPromise = null;

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function getFinalExtension(filename) {
    const normalized = String(filename || "").normalize("NFKC").replace(/\\/g, "/");
    const baseName = normalized.split("/").pop() || "";
    const dotIndex = baseName.lastIndexOf(".");
    return dotIndex < 0 ? "" : baseName.slice(dotIndex).toLowerCase();
  }

  function loadLibrary() {
    if (window.zip?.ZipReader && window.zip?.BlobReader && window.zip?.Uint8ArrayWriter) {
      return Promise.resolve(window.zip);
    }
    if (libraryPromise) {
      return libraryPromise;
    }

    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = libraryUrl;
      script.async = true;
      script.dataset.zipBmsLibrary = "true";
      script.addEventListener("load", () => {
        if (window.zip?.ZipReader && window.zip?.BlobReader && window.zip?.Uint8ArrayWriter) {
          resolve(window.zip);
          return;
        }
        reject(createError("ZIP_BROWSER_LIBRARY_FAILED", "ZIP解析ライブラリを初期化できませんでした。"));
      }, { once: true });
      script.addEventListener("error", () => {
        reject(createError("ZIP_BROWSER_LIBRARY_FAILED", "ZIP解析ライブラリを読み込めませんでした。"));
      }, { once: true });
      document.head.append(script);
    }).catch((error) => {
      libraryPromise = null;
      throw error;
    });

    return libraryPromise;
  }

  async function extractSingleBms(file) {
    if (!(file instanceof Blob)) {
      throw createError("ZIP_BROWSER_INVALID_FILE", "ZIPファイルを読み取れませんでした。");
    }

    const zip = await loadLibrary();
    const reader = new zip.ZipReader(new zip.BlobReader(file), {
      useWebWorkers: false,
      useCompressionStream: true
    });

    try {
      const entries = await reader.getEntries();
      if (entries.length > maxEntries) {
        throw createError("ZIP_TOO_MANY_ENTRIES", "ZIP内の項目数が上限を超えています。");
      }

      const charts = entries.filter((entry) => !entry.directory && chartExtensions.has(getFinalExtension(entry.filename)));
      if (charts.length === 0) {
        throw createError("ZIP_CHART_NOT_FOUND", "ZIP内に譜面ファイルが見つかりません。");
      }
      if (charts.length !== 1) {
        throw createError("ZIP_MULTIPLE_CHART_FILES", "ZIP内の譜面ファイルは1件だけにしてください。");
      }

      const chart = charts[0];
      if (chart.encrypted || chart.zipCrypto) {
        throw createError("ZIP_ENCRYPTED", "暗号化されたZIPは解析できません。");
      }
      if (![0, 8].includes(chart.compressionMethod)) {
        throw createError("ZIP_UNSUPPORTED_COMPRESSION", "対応していないZIP圧縮方式です。");
      }
      if (!Number.isSafeInteger(chart.uncompressedSize) || chart.uncompressedSize < 0 || chart.uncompressedSize > maxChartBytes) {
        throw createError("ZIP_CHART_TOO_LARGE", "ZIP内の譜面ファイルが2MiBを超えています。");
      }

      const bytes = await chart.getData(new zip.Uint8ArrayWriter(), {
        checkSignature: true,
        checkOverlappingEntry: true
      });
      if (bytes.byteLength > maxChartBytes || bytes.byteLength !== chart.uncompressedSize) {
        throw createError("ZIP_CHART_TOO_LARGE", "ZIP内の譜面ファイルを安全に展開できませんでした。");
      }

      return {
        fileName: chart.filename,
        buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      };
    } finally {
      await reader.close().catch(() => undefined);
    }
  }

  window.BmsZipReader = Object.freeze({
    extractSingleBms,
    isLibraryLoaded: () => Boolean(window.zip?.ZipReader),
    libraryUrl
  });
})();
