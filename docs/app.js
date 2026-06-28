const sampleCharts = [
  {
    id: "chart-001",
    title: "Starlit Mirage",
    artist: "Lumen",
    versions: [
      {
        version: "ver1.0",
        difficulty: "★10",
        author: "delta",
        progress: 100,
        comment: "LN少なめ。音源URLはコメントで共有する想定です。",
        fileId: "file-001"
      },
      {
        version: "ver2.0",
        difficulty: "★12",
        author: "delta",
        progress: 85,
        comment: "終盤を調整中。旧verもDL可能な想定です。",
        fileId: "file-002"
      }
    ]
  },
  {
    id: "chart-002",
    title: "Blue Archive",
    artist: "sora",
    versions: [
      {
        version: "ver1.0",
        difficulty: "",
        author: "nanasi",
        progress: 60,
        comment: "想定難易度は未入力の例です。",
        fileId: "file-003"
      }
    ]
  }
];

const allowedChartExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);
const readableChartExtensions = new Set([".bms", ".bme", ".bml"]);

const form = document.querySelector("#chartForm");
const fileInput = document.querySelector("#chartFile");
const titleInput = document.querySelector("#title");
const artistInput = document.querySelector("#artist");
const progressInput = document.querySelector("#progress");
const errorBox = document.querySelector("#errorBox");
const chartList = document.querySelector("#chartList");

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
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
    showError("投稿対象は .bms .bme .bml .zip のみです。");
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
    showError("譜面情報の読み取りに失敗しました。曲名とアーティストは手入力してください。");
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
  const valid = isValidProgress(progressInput.value);
  progressInput.setAttribute("aria-invalid", String(!valid));

  if (!valid) {
    showError("進捗度は0から100までの整数で入力してください。");
    return false;
  }

  clearError();
  return true;
}

function renderCharts() {
  chartList.innerHTML = sampleCharts.map((chart) => {
    const rows = chart.versions.map((version) => {
      const difficulty = version.difficulty || "未入力";
      const downloadHref = `#download-${version.fileId}`;

      return `
        <div class="version-row">
          <div class="version-tag">${version.version}</div>
          <div class="meta-block">
            <span class="meta-label">想定難易度</span>
            <span class="meta-value">${difficulty}</span>
          </div>
          <div class="meta-block">
            <span class="meta-label">差分作者</span>
            <span class="meta-value">${version.author}</span>
          </div>
          <div class="meta-block">
            <span class="meta-label">進捗度</span>
            <span class="progress-pill">${version.progress}%</span>
          </div>
          <div class="meta-block">
            <span class="meta-label">コメント</span>
            <span class="meta-value">${version.comment}</span>
          </div>
          <div class="version-actions">
            <a href="${downloadHref}">DL</a>
            <button class="secondary" type="button" data-chart-id="${chart.id}">追記投稿</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <article class="chart-group">
        <div class="chart-title-row">
          <h3>${chart.title}</h3>
          <span class="artist-separator">/</span>
          <span class="chart-artist">${chart.artist}</span>
        </div>
        <div class="version-list">${rows}</div>
      </article>
    `;
  }).join("");
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

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!validateProgress()) {
    return;
  }

  clearError();
});

chartList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-chart-id]");

  if (!button) {
    return;
  }

  const chart = sampleCharts.find((item) => item.id === button.dataset.chartId);

  if (!chart) {
    console.error("[append-version-select] chart not found", {
      code: "CHART_NOT_FOUND",
      chartId: button.dataset.chartId
    });
    showError("対象の曲が見つかりませんでした。");
    return;
  }

  titleInput.value = chart.title;
  artistInput.value = chart.artist;
  window.scrollTo({ top: 0, behavior: "smooth" });
  clearError();
});

renderCharts();
