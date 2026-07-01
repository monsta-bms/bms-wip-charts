const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
const PASSWORD_STORAGE_KEY = "bms-wip-charts-admin-password";

const allowedChartExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);
const readableChartExtensions = new Set([".bms", ".bme", ".bml"]);

const form = document.querySelector("#chartForm");
const fileInput = document.querySelector("#chartFile");
const titleInput = document.querySelector("#title");
const subtitleInput = document.querySelector("#subtitle");
const artistInput = document.querySelector("#artist");
const subartistInput = document.querySelector("#subartist");
const chartNameInput = document.querySelector("#chartName");
const difficultyInput = document.querySelector("#difficulty");
const levelInput = document.querySelector("#level");
const authorInput = document.querySelector("#author");
const progressInput = document.querySelector("#progress");
const commentInput = document.querySelector("#comment");
const isRejectedInput = document.querySelector("#isRejected");
const passwordInput = document.querySelector("#password");
const savePasswordInput = document.querySelector("#savePassword");
const submitButton = document.querySelector("#submitButton");
const errorBox = document.querySelector("#errorBox");
const chartList = document.querySelector("#chartList");

let isSubmitting = false;

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return replacements[character];
  });
}

function showError(error) {
  const code = error?.code || "REQUEST_FAILED";
  const message = error?.message || "処理に失敗しました。";
  const detail = error?.detail || "ブラウザの開発者ツールで通信状況を確認してください。";

  errorBox.textContent = `code: ${code}\nmessage: ${message}\ndetail: ${detail}`;
  errorBox.hidden = false;
}

function showTextError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function setSubmitting(nextValue) {
  isSubmitting = nextValue;
  submitButton.disabled = nextValue;
  submitButton.textContent = nextValue ? "送信中" : "投稿する";
}

function getExtension(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) {
    return "";
  }
  return fileName.slice(dotIndex).toLowerCase();
}

function decodeBuffer(buffer, encoding) {
  const decoder = new TextDecoder(encoding, { fatal: false });
  return decoder.decode(buffer);
}

function countReplacementCharacters(text) {
  return (text.match(/\uFFFD/g) || []).length;
}

function decodeBmsText(buffer) {
  const utf8Text = decodeBuffer(buffer, "utf-8");
  const shiftJisText = decodeBuffer(buffer, "shift-jis");

  if (countReplacementCharacters(shiftJisText) < countReplacementCharacters(utf8Text)) {
    return shiftJisText;
  }

  return utf8Text;
}

function parseBmsMeta(text) {
  const meta = { title: "", artist: "" };
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const titleMatch = line.match(/^#TITLE\s+(.+)$/i);
    const artistMatch = line.match(/^#ARTIST\s+(.+)$/i);

    if (titleMatch && !meta.title) {
      meta.title = titleMatch[1].trim();
    }

    if (artistMatch && !meta.artist) {
      meta.artist = artistMatch[1].trim();
    }

    if (meta.title && meta.artist) {
      break;
    }
  }

  return meta;
}

async function fillMetaFromFile(file) {
  const extension = getExtension(file.name);

  if (!allowedChartExtensions.has(extension)) {
    showTextError("投稿対象は .bms .bme .bml .zip のみです。");
    fileInput.value = "";
    return;
  }

  if (!readableChartExtensions.has(extension)) {
    clearError();
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const text = decodeBmsText(buffer);
    const meta = parseBmsMeta(text);

    if (meta.title) {
      titleInput.value = meta.title;
    }

    if (meta.artist) {
      artistInput.value = meta.artist;
    }

    clearError();
  } catch (error) {
    console.error("[file-meta-read] failed to read chart metadata", {
      code: "TITLE_ARTIST_PARSE_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
    showTextError("譜面情報の読み取りに失敗しました。曲名とアーティストは手入力してください。");
  }
}

function isValidProgress(value) {
  if (value.trim() === "") {
    return false;
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 100;
}

function validateProgress() {
  if (isRejectedInput.checked) {
    progressInput.value = "100";
  }

  const valid = isValidProgress(progressInput.value);
  progressInput.setAttribute("aria-invalid", String(!valid));

  if (!valid) {
    showTextError("進捗度は0から100までの整数で入力してください。");
    return false;
  }

  clearError();
  return true;
}

function validateRequiredFields() {
  const missingFields = [];

  if (!fileInput.files?.[0]) missingFields.push("譜面ファイル");
  if (!titleInput.value.trim()) missingFields.push("曲名");
  if (!artistInput.value.trim()) missingFields.push("アーティスト");
  if (!chartNameInput.value.trim()) missingFields.push("差分名");
  if (!authorInput.value.trim()) missingFields.push("差分作者");
  if (!passwordInput.value.trim()) missingFields.push("管理パスワード");

  if (missingFields.length > 0) {
    showTextError(`未入力の項目があります: ${missingFields.join(", ")}`);
    return false;
  }

  return true;
}

function applyRejectedProgressState() {
  if (isRejectedInput.checked) {
    progressInput.value = "100";
    progressInput.readOnly = true;
    progressInput.classList.add("readonly-input");
    progressInput.setAttribute("aria-invalid", "false");
    return;
  }

  progressInput.readOnly = false;
  progressInput.classList.remove("readonly-input");
}

function loadSavedPassword() {
  try {
    const savedPassword = localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (savedPassword) {
      passwordInput.value = savedPassword;
      savePasswordInput.checked = true;
    }
  } catch (error) {
    console.error("[password-storage-load] failed to load saved password", {
      code: "LOCAL_STORAGE_READ_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function persistPasswordPreference() {
  try {
    if (savePasswordInput.checked && passwordInput.value) {
      localStorage.setItem(PASSWORD_STORAGE_KEY, passwordInput.value);
      return;
    }

    localStorage.removeItem(PASSWORD_STORAGE_KEY);
  } catch (error) {
    console.error("[password-storage-save] failed to save password preference", {
      code: "LOCAL_STORAGE_WRITE_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw {
      code: "INVALID_JSON_RESPONSE",
      message: "APIレスポンスの解析に失敗しました。",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(buildApiUrl(path), options);
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw body || {
      code: "HTTP_ERROR",
      message: "APIリクエストに失敗しました。",
      detail: `HTTP status ${response.status}`
    };
  }

  return body;
}

function buildDownloadUrl(downloadUrl) {
  if (!downloadUrl) {
    return "";
  }

  return new URL(downloadUrl, API_BASE_URL).toString();
}

function renderLoading() {
  chartList.innerHTML = `<div class="list-status">読み込み中</div>`;
}

function renderEmpty() {
  chartList.innerHTML = `<div class="list-status">投稿はまだありません。</div>`;
}

function renderCharts(data) {
  const charts = Array.isArray(data?.charts) ? data.charts : [];

  if (charts.length === 0) {
    renderEmpty();
    return;
  }

  chartList.innerHTML = charts.map((entry) => {
    const song = entry.song || {};
    const chart = entry.chart || {};
    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    const rows = versions.map((version) => {
      const difficulty = version.difficulty || "未入力";
      const level = version.level ? ` / ${version.level}` : "";
      const progress = Number.isFinite(Number(version.progress)) ? Number(version.progress) : 0;
      const downloadHref = buildDownloadUrl(version.file?.downloadUrl);
      const rejectedBadge = version.isRejected ? `<span class="rejected-badge">没譜面</span>` : "";
      const downloadControl = downloadHref
        ? `<a href="${escapeHtml(downloadHref)}">DL</a>`
        : `<span class="download-disabled">DL不可</span>`;

      return `
        <div class="version-row">
          <div class="version-tag">${escapeHtml(version.displayVersion || "ver?.?")}</div>
          <div class="meta-block">
            <span class="meta-label">想定難易度</span>
            <span class="meta-value">${escapeHtml(difficulty)}${escapeHtml(level)}</span>
          </div>
          <div class="meta-block">
            <span class="meta-label">差分作者</span>
            <span class="meta-value">${escapeHtml(version.author || "未入力")}</span>
          </div>
          <div class="meta-block">
            <span class="meta-label">進捗度</span>
            <span class="progress-pill">${escapeHtml(progress)}%</span>
            ${rejectedBadge}
          </div>
          <div class="meta-block">
            <span class="meta-label">コメント</span>
            <span class="meta-value">${escapeHtml(version.comment || "")}</span>
          </div>
          <div class="version-actions">
            ${downloadControl}
            <button class="secondary" type="button" disabled>追記投稿</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <article class="chart-group">
        <div class="chart-title-row">
          <h3>${escapeHtml(song.title || "無題")}</h3>
          <span class="artist-separator">/</span>
          <span class="chart-artist">${escapeHtml(song.artist || "Unknown Artist")}</span>
          <span class="chart-name-badge">${escapeHtml(chart.name || "差分名未入力")}</span>
        </div>
        <div class="version-list">${rows || `<div class="list-status">表示できるversionがありません。</div>`}</div>
      </article>
    `;
  }).join("");
}

async function loadCharts() {
  renderLoading();

  try {
    const data = await apiRequest("/api/charts?page=1&pageSize=100");
    renderCharts(data);
  } catch (error) {
    console.error("[api-charts-list] failed to load charts", {
      code: error?.code || "CHARTS_LIST_FAILED",
      message: error?.detail || error?.message || String(error)
    });
    chartList.innerHTML = `<div class="list-status">一覧を読み込めませんでした。</div>`;
    showError(error);
  }
}

function buildChartFormData() {
  const file = fileInput.files?.[0];
  const formData = new FormData();

  formData.append("file", file);
  formData.append("title", titleInput.value.trim());
  formData.append("subtitle", subtitleInput.value.trim());
  formData.append("artist", artistInput.value.trim());
  formData.append("subartist", subartistInput.value.trim());
  formData.append("chartName", chartNameInput.value.trim());
  formData.append("difficulty", difficultyInput.value.trim());
  formData.append("level", levelInput.value.trim());
  formData.append("author", authorInput.value.trim());
  formData.append("progress", isRejectedInput.checked ? "100" : progressInput.value.trim());
  formData.append("comment", commentInput.value.trim());
  formData.append("isRejected", isRejectedInput.checked ? "true" : "false");
  formData.append("password", passwordInput.value);

  return formData;
}

async function submitChart() {
  if (isSubmitting) {
    return;
  }

  if (!validateRequiredFields() || !validateProgress()) {
    return;
  }

  setSubmitting(true);
  clearError();

  try {
    persistPasswordPreference();
    await apiRequest("/api/charts", {
      method: "POST",
      body: buildChartFormData()
    });

    const savedPassword = passwordInput.value;
    const shouldRestorePassword = savePasswordInput.checked;
    form.reset();
    progressInput.value = "100";
    if (shouldRestorePassword) {
      passwordInput.value = savedPassword;
      savePasswordInput.checked = true;
    }
    applyRejectedProgressState();
    await loadCharts();
  } catch (error) {
    console.error("[api-chart-create] failed to create chart", {
      code: error?.code || "CHART_CREATE_FAILED",
      message: error?.detail || error?.message || String(error)
    });
    showError(error);
  } finally {
    setSubmitting(false);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (!file) {
    clearError();
    return;
  }

  fillMetaFromFile(file);
});

progressInput.addEventListener("input", () => {
  if (progressInput.getAttribute("aria-invalid") === "true") {
    validateProgress();
  }
});

isRejectedInput.addEventListener("change", () => {
  applyRejectedProgressState();
  clearError();
});

savePasswordInput.addEventListener("change", persistPasswordPreference);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitChart();
});

loadSavedPassword();
applyRejectedProgressState();
loadCharts();
