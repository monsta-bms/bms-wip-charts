import {
  DifficultyTableViewModel,
  latestDifficultyTableTimestamp
} from "./difficultyTableDisplay";

export type DifficultyTableHtmlTheme = "white" | "default" | "dark";

export type DifficultyTableHtmlDefinition = {
  id: "rc-star" | "rc-double-star";
  name: string;
  symbol: string;
  levelOrder: string[];
};

type DifficultyTableHtmlInput = {
  request: Request;
  table: DifficultyTableHtmlDefinition;
  theme: DifficultyTableHtmlTheme;
  models: DifficultyTableViewModel[];
};

const BMS_IR_BASE_URL = "https://bms-ir.org/new/song?songmd5=";

const PAGE_STYLE = `
:root {
  color-scheme: light;
  --page-bg: #e4e9e7;
  --header-bg: #d5dfdb;
  --surface: #f4f7f6;
  --surface-alt: #e8eeeb;
  --surface-hover: #dde8e3;
  --text: #1d2926;
  --muted: #52635e;
  --border: #aab9b4;
  --border-strong: #6e8b81;
  --link: #155241;
  --link-hover: #0b382c;
  --focus: #9a5a00;
  --level-bg: #1f6652;
  --level-text: #ffffff;
  --missing: #6a7773;
}
html[data-theme="white"] {
  --page-bg: #f7f9fa;
  --header-bg: #edf2f0;
  --surface: #ffffff;
  --surface-alt: #f1f5f3;
  --surface-hover: #e8f1ed;
  --text: #18221f;
  --muted: #5a6864;
  --border: #c7d2ce;
  --border-strong: #82978f;
  --link: #195443;
  --link-hover: #0d362b;
  --focus: #9b5800;
  --level-bg: #2d6b59;
  --level-text: #ffffff;
  --missing: #687571;
}
html[data-theme="dark"] {
  color-scheme: dark;
  --page-bg: #101613;
  --header-bg: #151e1b;
  --surface: #1a2421;
  --surface-alt: #202d29;
  --surface-hover: #293a34;
  --text: #e5eeea;
  --muted: #a8b7b1;
  --border: #3b4e47;
  --border-strong: #668078;
  --link: #78d0b1;
  --link-hover: #a5ead2;
  --focus: #ffd166;
  --level-bg: #2b785f;
  --level-text: #ffffff;
  --missing: #91a19b;
}
*, *::before, *::after { box-sizing: border-box; }
html { min-width: 0; background: var(--page-bg); }
body {
  margin: 0;
  min-width: 0;
  min-height: 100vh;
  background: var(--page-bg);
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
a { color: var(--link); text-underline-offset: .18em; }
a:hover { color: var(--link-hover); }
a:focus-visible, summary:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}
.skip-link {
  position: fixed;
  z-index: 10;
  top: .5rem;
  left: .5rem;
  padding: .55rem .75rem;
  background: var(--surface);
  border: 2px solid var(--focus);
  transform: translateY(-180%);
}
.skip-link:focus { transform: none; }
.page-header { background: var(--header-bg); border-bottom: 1px solid var(--border); }
.page-header-inner, .page-main, .page-footer {
  width: min(100%, 1500px);
  margin: 0 auto;
  padding-inline: clamp(.75rem, 2.4vw, 2rem);
}
.page-header-inner { padding-block: 1rem; }
.eyebrow { margin: 0 0 .15rem; color: var(--muted); font-size: .82rem; font-weight: 700; }
h1 { margin: 0; font-size: clamp(1.45rem, 3vw, 2.25rem); line-height: 1.25; }
.switches { display: flex; flex-wrap: wrap; gap: .65rem 1.5rem; margin-top: .8rem; }
.switch-group { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; }
.switch-label { margin-right: .25rem; color: var(--muted); font-size: .8rem; font-weight: 700; }
.switch-link {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: .2rem .55rem;
  border: 1px solid transparent;
  border-radius: 3px;
  font-size: .9rem;
  font-weight: 700;
}
.switch-link[aria-current] {
  border-color: var(--border-strong);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.page-main { padding-block: 1rem 2rem; }
.intro {
  margin-bottom: 1.25rem;
  padding: .9rem 1rem;
  border: 1px solid var(--border);
  border-left: 5px solid var(--level-bg);
  background: var(--surface);
}
.intro h2 { margin: 0 0 .3rem; font-size: 1.05rem; }
.intro p { margin: 0; color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; margin-top: .65rem; }
.stats strong { color: var(--text); font-size: 1.05rem; }
.level-section { margin-top: 1.35rem; scroll-margin-top: 1rem; }
.level-heading {
  margin: 0;
  padding: .45rem .7rem;
  background: var(--level-bg);
  color: var(--level-text);
  font-size: 1.08rem;
  line-height: 1.35;
}
.table-shell { min-width: 0; border: 1px solid var(--border); border-top: 0; background: var(--surface); }
.difficulty-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.difficulty-table caption, .visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
.difficulty-table th, .difficulty-table td {
  min-width: 0;
  padding: .55rem .6rem;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
  word-break: normal;
}
.difficulty-table th:last-child, .difficulty-table td:last-child { border-right: 0; }
.difficulty-table tbody tr:last-child td { border-bottom: 0; }
.difficulty-table th { background: var(--surface-alt); font-size: .8rem; }
.difficulty-table tbody tr:nth-child(even) { background: var(--surface-alt); }
@media (hover: hover) { .difficulty-table tbody tr:hover { background: var(--surface-hover); } }
.cell-difficulty { font-weight: 800; white-space: nowrap; }
.title-link { font-weight: 750; }
.comment-original { font-size: .86rem; font-weight: 700; }
.comment-details { margin-top: .25rem; }
.comment-details summary {
  width: fit-content;
  min-height: 2rem;
  padding: .2rem .25rem;
  color: var(--link);
  cursor: pointer;
  font-size: .85rem;
  font-weight: 700;
}
.comment-text {
  max-width: 100%;
  margin-top: .35rem;
  padding: .5rem;
  border: 1px solid var(--border);
  background: var(--surface);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.compact-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  min-height: 2rem;
  padding: .15rem .35rem;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  font-size: .85rem;
  font-weight: 800;
  text-decoration: none;
}
.compact-link:hover { background: var(--surface-hover); }
.missing { color: var(--missing); }
.mobile-label { display: none; color: var(--muted); font-size: .75rem; font-weight: 800; }
.empty-state, .error-state {
  padding: clamp(1.25rem, 5vw, 2.5rem);
  border: 1px solid var(--border);
  background: var(--surface);
  text-align: center;
}
.empty-state p, .error-state p { margin: .3rem 0; }
.resource-links { margin: 1.5rem 0 0; color: var(--muted); font-size: .85rem; }
.resource-links a { margin-right: .75rem; }
.page-footer { padding-block: 0 2rem; color: var(--muted); font-size: .8rem; }
@media (min-width: 960px) {
  col.col-difficulty { width: 7rem; }
  col.col-title { width: 27%; }
  col.col-artist { width: 16%; }
  col.col-authors { width: 16%; }
  col.col-comment { width: 23%; }
  col.col-origin, col.col-download { width: 3.75rem; }
}
@media (max-width: 959px) {
  .difficulty-table, .difficulty-table tbody { display: block; width: 100%; }
  .difficulty-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
  .difficulty-table tr {
    display: grid;
    grid-template-columns: minmax(6.5rem, .38fr) minmax(0, 1fr);
    grid-template-areas:
      "difficulty title"
      "artist authors"
      "comment comment"
      "origin download";
    min-width: 0;
    padding: .65rem;
    border-bottom: 1px solid var(--border);
    gap: .55rem .75rem;
  }
  .difficulty-table tbody tr:last-child { border-bottom: 0; }
  .difficulty-table td {
    display: block;
    width: auto;
    padding: 0;
    border: 0;
  }
  .cell-difficulty { grid-area: difficulty; }
  .cell-title { grid-area: title; }
  .cell-artist { grid-area: artist; }
  .cell-authors { grid-area: authors; }
  .cell-comment { grid-area: comment; }
  .cell-origin { grid-area: origin; }
  .cell-download { grid-area: download; }
  .mobile-label { display: block; margin-bottom: .1rem; }
  .compact-link { min-width: 44px; min-height: 44px; }
  .comment-details summary { min-height: 44px; padding-block: .55rem; }
}
@media (max-width: 599px) {
  .page-header-inner, .page-main, .page-footer { padding-inline: .65rem; }
  .difficulty-table tr {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "difficulty" "title" "artist" "authors" "comment" "origin" "download";
  }
  .cell-origin, .cell-download { display: flex !important; align-items: center; gap: .65rem; }
  .cell-origin .mobile-label, .cell-download .mobile-label { min-width: 4.5rem; margin: 0; }
  .switches { gap: .5rem; }
}`;

export function getDifficultyTableHtmlTheme(request: Request): DifficultyTableHtmlTheme {
  const theme = new URL(request.url).searchParams.get("theme");
  return theme === "white" || theme === "dark" ? theme : "default";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"'=]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
    "=": "&#61;"
  })[character] ?? character);
}

function absoluteUrl(request: Request, path: string): string {
  return new URL(path, request.url).toString();
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeDownloadUrl(value: string, request: Request): string | null {
  const safeValue = safeHttpUrl(value);
  if (!safeValue) {
    return null;
  }
  const parsed = new URL(safeValue);
  const requestUrl = new URL(request.url);
  if (parsed.origin !== requestUrl.origin || !/^\/api\/files\/[^/]+$/u.test(parsed.pathname)) {
    return null;
  }
  return parsed.toString();
}

function timestampValue(value: string): number | null {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatJstTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = timestampValue(value);
  if (parsed === null) {
    return "—";
  }
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(parsed));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}/${values.get("month")}/${values.get("day")} ${values.get("hour")}:${values.get("minute")}`;
}

function levelSectionId(level: string): string {
  return /^\d+$/u.test(level) ? `level-${level}` : "level-other";
}

function renderSwitches(table: DifficultyTableHtmlDefinition, theme: DifficultyTableHtmlTheme): string {
  const tableLink = (id: DifficultyTableHtmlDefinition["id"], label: string) => {
    const current = id === table.id ? ' aria-current="page"' : "";
    return `<a class="switch-link" href="/difficulty-tables/${id}?theme=${theme}"${current}>${label}</a>`;
  };
  const themeLink = (value: DifficultyTableHtmlTheme, label: string) => {
    const current = value === theme ? ' aria-current="true"' : "";
    return `<a class="switch-link" href="/difficulty-tables/${table.id}?theme=${value}"${current}>${label}</a>`;
  };
  return `<div class="switches">
      <nav class="switch-group" aria-label="難易度表の切替">
        <span class="switch-label">表</span>
        ${tableLink("rc-star", "RC★")}
        ${tableLink("rc-double-star", "RC★★")}
      </nav>
      <nav class="switch-group" aria-label="表示テーマの切替">
        <span class="switch-label">テーマ</span>
        ${themeLink("white", "ホワイト")}
        ${themeLink("default", "デフォルト")}
        ${themeLink("dark", "ダーク")}
      </nav>
    </div>`;
}

function renderMissing(): string {
  return '<span class="missing" aria-label="情報なし">—</span>';
}

function renderModelRow(model: DifficultyTableViewModel, request: Request): string {
  const displayTitle = model.displayTitle || "—";
  const escapedTitle = escapeHtml(displayTitle);
  const md5 = model.md5.toLowerCase();
  const titleContent = /^[0-9a-f]{32}$/u.test(md5)
    ? `<a class="title-link" href="${BMS_IR_BASE_URL}${md5}" target="_blank" rel="noopener noreferrer" title="BMS-IRで譜面情報を開く" aria-label="${escapeHtml(`${displayTitle}をBMS-IRで開く`)}">${escapedTitle}</a>`
    : escapedTitle;
  const originUrl = safeHttpUrl(model.originUrl);
  const originContent = originUrl
    ? `<a class="compact-link" href="${escapeHtml(originUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${displayTitle}の原曲・本体配布ページを開く`)}">曲</a>`
    : renderMissing();
  const downloadUrl = safeDownloadUrl(model.downloadUrl, request);
  const downloadContent = downloadUrl
    ? `<a class="compact-link" href="${escapeHtml(downloadUrl)}" aria-label="${escapeHtml(`${displayTitle}の譜面ファイルをダウンロード`)}">DL</a>`
    : renderMissing();
  const commentDetails = model.postComment
    ? `<details class="comment-details"><summary>コメントを見る</summary><div class="comment-text">${escapeHtml(model.postComment)}</div></details>`
    : "";
  return `<tr role="row">
          <td role="cell" class="cell-difficulty" data-label="難易度"><span class="mobile-label" aria-hidden="true">難易度</span>${escapeHtml(model.levelLabel)}</td>
          <td role="cell" class="cell-title" data-label="曲名"><span class="mobile-label" aria-hidden="true">曲名</span>${titleContent}</td>
          <td role="cell" class="cell-artist" data-label="アーティスト"><span class="mobile-label" aria-hidden="true">アーティスト</span>${model.displayArtist ? escapeHtml(model.displayArtist) : renderMissing()}</td>
          <td role="cell" class="cell-authors" data-label="作者一覧"><span class="mobile-label" aria-hidden="true">作者一覧</span>${model.authorsText ? escapeHtml(model.authorsText) : renderMissing()}</td>
          <td role="cell" class="cell-comment" data-label="コメント"><span class="mobile-label" aria-hidden="true">コメント</span><div class="comment-original">元難易度：${escapeHtml(model.originalDifficulty)}</div>${commentDetails}</td>
          <td role="cell" class="cell-origin" data-label="曲"><span class="mobile-label" aria-hidden="true">曲</span>${originContent}</td>
          <td role="cell" class="cell-download" data-label="DL"><span class="mobile-label" aria-hidden="true">DL</span>${downloadContent}</td>
        </tr>`;
}

function renderLevelSection(
  table: DifficultyTableHtmlDefinition,
  level: string,
  models: DifficultyTableViewModel[],
  request: Request
): string {
  const id = levelSectionId(level);
  const heading = `${table.symbol}${level}（${models.length}譜面）`;
  return `<section class="level-section" aria-labelledby="${id}">
      <h2 class="level-heading" id="${id}">${escapeHtml(heading)}</h2>
      <div class="table-shell">
        <table class="difficulty-table" role="table" aria-labelledby="${id}">
          <caption>${escapeHtml(heading)}の譜面一覧</caption>
          <colgroup>
            <col class="col-difficulty"><col class="col-title"><col class="col-artist"><col class="col-authors"><col class="col-comment"><col class="col-origin"><col class="col-download">
          </colgroup>
          <thead role="rowgroup"><tr role="row">
            <th role="columnheader" scope="col">難易度</th><th role="columnheader" scope="col">曲名</th><th role="columnheader" scope="col">アーティスト</th><th role="columnheader" scope="col">作者一覧</th><th role="columnheader" scope="col">コメント</th><th role="columnheader" scope="col">曲</th><th role="columnheader" scope="col">DL</th>
          </tr></thead>
          <tbody role="rowgroup">
        ${models.map((model) => renderModelRow(model, request)).join("\n        ")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderHead(
  request: Request,
  table: DifficultyTableHtmlDefinition,
  theme: DifficultyTableHtmlTheme
): string {
  const headerUrl = absoluteUrl(request, `/api/difficulty-tables/${table.id}/header.json`);
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="bmstable" content="${escapeHtml(headerUrl)}">
  <title>${escapeHtml(table.name)}</title>
  <style>${PAGE_STYLE}</style>
</head>`;
}

function renderResourceLinks(request: Request, table: DifficultyTableHtmlDefinition): string {
  const headerUrl = absoluteUrl(request, `/api/difficulty-tables/${table.id}/header.json`);
  const dataUrl = absoluteUrl(request, `/api/difficulty-tables/${table.id}/data.json`);
  return `<p class="resource-links">難易度表取込用：<a href="${escapeHtml(headerUrl)}">header.json</a><a href="${escapeHtml(dataUrl)}">data.json</a></p>`;
}

export function buildDifficultyTableHtml(input: DifficultyTableHtmlInput): string {
  let latestUpdatedAt: string | null = null;
  for (const model of input.models) {
    latestUpdatedAt = latestDifficultyTableTimestamp(latestUpdatedAt, model.updatedAt);
  }
  const sections = input.table.levelOrder.flatMap((level) => {
    const models = input.models.filter((model) => model.level === level);
    return models.length > 0 ? [renderLevelSection(input.table, level, models, input.request)] : [];
  });
  const content = sections.length > 0
    ? sections.join("\n    ")
    : '<div class="empty-state"><p>現在、この難易度に掲載されている譜面はありません。</p></div>';
  return `<!doctype html>
<html lang="ja" data-theme="${input.theme}">
${renderHead(input.request, input.table, input.theme)}
<body>
  <a class="skip-link" href="#main-content">本文へ移動</a>
  <header class="page-header">
    <div class="page-header-inner">
      <p class="eyebrow">BMS差分共有サイト・完成版難易度表</p>
      <h1>${escapeHtml(input.table.name)}</h1>
      ${renderSwitches(input.table, input.theme)}
    </div>
  </header>
  <main class="page-main" id="main-content">
    <section class="intro" aria-labelledby="table-description-heading">
      <h2 id="table-description-heading">この難易度表について</h2>
      <p>制作途中譜面共有サイトへ投稿された完成版を掲載し、投稿時の難易度をRC難易度へ変換しています。元難易度はコメント欄、曲名はBMS-IR、「曲」は原曲・本体ページ、「DL」は投稿された譜面ファイルへのリンクです。</p>
      <div class="stats" aria-label="掲載状況"><strong>全${input.models.length}譜面</strong><span>最終更新：${formatJstTimestamp(latestUpdatedAt)}</span></div>
    </section>
    ${content}
    ${renderResourceLinks(input.request, input.table)}
  </main>
  <footer class="page-footer">本表は投稿時の自己申告難易度をRC難易度へ変換した一覧です。</footer>
</body>
</html>`;
}

export function buildDifficultyTableErrorHtml(
  request: Request,
  table: DifficultyTableHtmlDefinition,
  theme: DifficultyTableHtmlTheme
): string {
  return `<!doctype html>
<html lang="ja" data-theme="${theme}">
${renderHead(request, table, theme)}
<body>
  <main class="page-main" id="main-content">
    <div class="error-state" role="alert">
      <h1>難易度表を読み込めませんでした。</h1>
      <p>時間を置いて再読み込みしてください。</p>
    </div>
    ${renderResourceLinks(request, table)}
  </main>
</body>
</html>`;
}
