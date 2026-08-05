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
export const PUBLIC_SITE_HOME_URL = "https://monsta-bms.github.io/bms-wip-charts/";

const PAGE_STYLE = `
:root {
  color-scheme: light;
  --page-bg: #f4f5f5;
  --header-bg: #e2e7e5;
  --surface: #ffffff;
  --table-head: #f2f4f4;
  --row: #ffffff;
  --row-alt: #f6f7f7;
  --row-hover: #eef2f1;
  --text: #111820;
  --muted: #47525a;
  --border: #d3d7d9;
  --link: #075fd8;
  --link-hover: #0049a8;
  --focus: #0b6bce;
  --level-bg: #293330;
}
html[data-theme="white"] {
  --page-bg: #ffffff;
  --header-bg: #f1f4f3;
  --table-head: #f7f8f8;
  --row-alt: #f8f9f9;
  --row-hover: #f0f3f2;
  --text: #0e151b;
  --muted: #4b565d;
  --border: #d9dcde;
  --link: #005cc7;
  --link-hover: #00428f;
  --focus: #0069d9;
  --level-bg: #39423f;
}
html[data-theme="dark"] {
  color-scheme: dark;
  --page-bg: #121619;
  --header-bg: #1d2426;
  --surface: #191f22;
  --table-head: #20272a;
  --row: #191f22;
  --row-alt: #1d2427;
  --row-hover: #252e32;
  --text: #eef2f4;
  --muted: #b5bec3;
  --border: #3e474c;
  --link: #8fc3ff;
  --link-hover: #c2ddff;
  --focus: #75baff;
  --level-bg: #303b38;
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
  line-height: 1.45;
  overflow-wrap: anywhere;
  font-size: 16px;
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
.page-header-inner { display: grid; gap: .4rem; padding-block: .7rem; }
h1 { margin: 0; font-size: clamp(1.4rem, 2.8vw, 2rem); line-height: 1.2; }
.switches { margin-top: .45rem; }
.header-navigation { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; margin-top: .45rem; }
.switch-group { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; }
.switch-label { margin-right: .25rem; color: var(--muted); font-size: .8rem; font-weight: 700; }
.switch-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: .3rem .5rem;
  border-bottom: 2px solid transparent;
  font-size: .9rem;
  font-weight: 600;
}
.home-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: .35rem .65rem;
  border: 1px solid var(--border);
  border-radius: .35rem;
  background: var(--surface);
  font-size: .84rem;
  font-weight: 750;
}
.switch-link[aria-current] {
  border-bottom-color: currentColor;
  color: var(--text);
  text-decoration: none;
}
.page-main { padding-block: .75rem 1.5rem; }
.intro {
  margin-bottom: .8rem;
  padding: .6rem .75rem;
  border: 1px solid var(--border);
  background: var(--surface);
}
.intro h2 { margin: 0 0 .3rem; font-size: 1.15rem; }
.intro p { margin: 0; color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: .15rem 1rem; margin-top: .4rem; font-size: .9rem; }
.stats strong { color: var(--text); }
.level-section { margin-top: .9rem; scroll-margin-top: .75rem; }
.level-heading {
  margin: 0;
  padding: .35rem .65rem;
  background: var(--level-bg);
  color: #ffffff;
  font-size: 1rem;
  line-height: 1.35;
}
.table-shell { min-width: 0; border: 1px solid var(--border); border-top: 0; background: var(--surface); }
.difficulty-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.difficulty-table caption {
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
  padding: .4375rem .5625rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
  word-break: normal;
}
.difficulty-table tbody tr:last-child td { border-bottom: 0; }
.difficulty-table th { padding-block: .5rem; background: var(--table-head); font-size: .875rem; font-weight: 650; }
.difficulty-table th:nth-last-child(-n+2) { text-align: center; }
.difficulty-table tbody .chart-row:nth-child(odd) { background: var(--row); }
.difficulty-table tbody .chart-row:nth-child(even) { background: var(--row-alt); }
@media (hover: hover) { .difficulty-table tbody .chart-row:hover { background: var(--row-hover); } }
.cell-difficulty { font-weight: 800; white-space: nowrap; }
.title-link { font-weight: 500; text-decoration: underline; }
.cell-authors { color: var(--muted); }
.comment-summary { display: flex; flex-wrap: wrap; align-items: center; gap: .1rem .4rem; }
.original-difficulty { color: var(--muted); font-size: .875rem; white-space: nowrap; }
.row-comment { display: inline-block; }
.row-comment summary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  min-height: 40px;
  padding: .25rem .5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--link);
  cursor: pointer;
  font-size: 1.05rem;
  line-height: 1;
  list-style: none;
}
.row-comment summary::-webkit-details-marker { display: none; }
.row-comment summary:hover { background: var(--row-hover); border-color: var(--link); }
.row-comment summary:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.row-comment summary:active,
.row-comment[open] summary { background: var(--row-hover); border-color: var(--link); }
.comment-body {
  margin-top: .25rem;
  padding: .35rem .45rem;
  border-top: 1px solid var(--border);
  background: transparent;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.action-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  min-height: 40px;
  padding: .25rem .5rem;
  border: 0;
  background: none;
  font-size: .85rem;
  font-weight: 700;
}
.action-link:hover { text-decoration-thickness: 2px; }
.missing { color: var(--muted); }
.mobile-label { display: none; color: var(--muted); font-size: .75rem; font-weight: 800; }
.empty-state, .error-state {
  padding: clamp(1.25rem, 5vw, 2.5rem);
  border: 1px solid var(--border);
  background: var(--surface);
  text-align: center;
}
.empty-state p, .error-state p { margin: .3rem 0; }
.resource-links { margin: 1.5rem 0 0; color: var(--muted); font-size: .875rem; }
.resource-links summary { cursor: pointer; font-weight: 650; min-height: 40px; padding-block: .45rem; }
.resource-link-list { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin: .25rem 0 0; }
.page-footer { padding-block: 0 2rem; color: var(--muted); font-size: .8rem; }
@media (min-width: 960px) {
  col.col-difficulty { width: 5.5rem; }
  col.col-title { width: 30%; }
  col.col-artist { width: 20%; }
  col.col-authors { width: 17%; }
  col.col-comment { width: 15%; }
  col.col-origin, col.col-download { width: 3.25rem; }
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
    padding: .5rem;
    border-bottom: 1px solid var(--border);
    gap: .4rem .65rem;
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
  .switch-link, .action-link, .row-comment summary { min-width: 44px; min-height: 44px; }
}
@media (max-width: 599px) {
  .page-header-inner, .page-main, .page-footer { padding-inline: .65rem; }
  .difficulty-table tr {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "difficulty difficulty"
      "title title"
      "artist artist"
      "authors authors"
      "comment comment"
      "origin download";
  }
  .cell-origin, .cell-download { display: flex !important; flex-wrap: wrap; align-items: center; gap: .3rem .55rem; }
  .cell-origin .mobile-label, .cell-download .mobile-label { margin: 0; }
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
  return /^\d+$/u.test(level) ? `level-${level}-heading` : "level-other-heading";
}

function renderHomeLink(): string {
  return `<a class="home-link" href="${PUBLIC_SITE_HOME_URL}">← リサイクルセンターへ戻る</a>`;
}

function renderSwitches(table: DifficultyTableHtmlDefinition, theme: DifficultyTableHtmlTheme): string {
  const tableLink = (id: DifficultyTableHtmlDefinition["id"], label: string) => {
    const current = id === table.id ? ' aria-current="page"' : "";
    return `<a class="switch-link" href="/difficulty-tables/${id}?theme=${theme}"${current}>${label}</a>`;
  };
  const themeLink = (value: DifficultyTableHtmlTheme, label: string) => {
    const current = value === theme ? ' aria-current="page"' : "";
    return `<a class="switch-link" href="/difficulty-tables/${table.id}?theme=${value}"${current}>${label}</a>`;
  };
  return `<div class="header-navigation">
      <div class="switches">
      <nav class="switch-group" aria-label="難易度表の切替">
        <span class="switch-label">難易度表</span>
        ${tableLink("rc-star", "RC★")}
        ${tableLink("rc-double-star", "RC★★")}
      </nav>
      </div>
      <nav class="switch-group" aria-label="テーマの切替">
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
    ? `<a class="action-link" href="${escapeHtml(originUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${displayTitle}の原曲・本体配布ページを開く`)}">原曲</a>`
    : renderMissing();
  const downloadUrl = safeDownloadUrl(model.downloadUrl, request);
  const downloadContent = downloadUrl
    ? `<a class="action-link" href="${escapeHtml(downloadUrl)}" aria-label="${escapeHtml(`${displayTitle}の譜面ファイルをダウンロード`)}">DL</a>`
    : renderMissing();
  const commentDetails = model.postComment
    ? `<details class="row-comment"><summary aria-label="コメント" title="コメントを表示">💬</summary><div class="comment-body">${escapeHtml(model.postComment)}</div></details>`
    : "";
  return `<tr class="chart-row" role="row">
          <td role="cell" class="cell-difficulty" data-label="難易度"><span class="mobile-label" aria-hidden="true">難易度</span>${escapeHtml(model.levelLabel)}</td>
          <td role="cell" class="cell-title" data-label="曲名"><span class="mobile-label" aria-hidden="true">曲名</span>${titleContent}</td>
          <td role="cell" class="cell-artist" data-label="アーティスト"><span class="mobile-label" aria-hidden="true">アーティスト</span>${model.displayArtist ? escapeHtml(model.displayArtist) : renderMissing()}</td>
          <td role="cell" class="cell-authors" data-label="作者一覧"><span class="mobile-label" aria-hidden="true">作者一覧</span>${model.authorsText ? escapeHtml(model.authorsText) : renderMissing()}</td>
          <td role="cell" class="cell-comment" data-label="コメント"><span class="mobile-label" aria-hidden="true">コメント</span><div class="comment-summary"><span class="original-difficulty">元: ${escapeHtml(model.originalDifficulty)}</span>${commentDetails}</div></td>
          <td role="cell" class="cell-origin" data-label="原曲"><span class="mobile-label" aria-hidden="true">原曲</span>${originContent}</td>
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
            <th role="columnheader" scope="col">難易度</th><th role="columnheader" scope="col">曲名</th><th role="columnheader" scope="col">アーティスト</th><th role="columnheader" scope="col">作者一覧</th><th role="columnheader" scope="col">コメント</th><th role="columnheader" scope="col">原曲</th><th role="columnheader" scope="col">DL</th>
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
  return `<details class="resource-links"><summary>難易度表の取込用リンク</summary><p class="resource-link-list"><a href="${escapeHtml(headerUrl)}">header.json</a><a href="${escapeHtml(dataUrl)}">data.json</a></p></details>`;
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
    : `<div class="empty-state"><p>現在、この難易度に掲載されている譜面はありません。</p><p>${renderHomeLink()} <a class="home-link" href="${PUBLIC_SITE_HOME_URL}list.html">投稿一覧を見る</a></p></div>`;
  return `<!doctype html>
<html lang="ja" data-theme="${input.theme}">
${renderHead(input.request, input.table, input.theme)}
<body>
  <a class="skip-link" href="#main-content">本文へ移動</a>
  <header class="page-header">
    <div class="page-header-inner">
      ${renderHomeLink()}
      <h1>${escapeHtml(input.table.name)}</h1>
      ${renderSwitches(input.table, input.theme)}
    </div>
  </header>
  <main class="page-main" id="main-content">
    <section class="intro" aria-labelledby="table-description-heading">
      <h2 id="table-description-heading">この難易度表について</h2>
      <p>完成版と完成済み没譜面を掲載しています。曲名はBMS-IR、原曲は本体・原曲配布先、DLは差分ファイル、コメントは投稿者コメントです。</p>
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
    <p>${renderHomeLink()}</p>
    <div class="error-state" role="alert">
      <h1>難易度表を読み込めませんでした。</h1>
      <p>時間を置いて、<a href="${escapeHtml(request.url)}">このページを再読み込み</a>してください。</p>
    </div>
    ${renderResourceLinks(request, table)}
  </main>
</body>
</html>`;
}
