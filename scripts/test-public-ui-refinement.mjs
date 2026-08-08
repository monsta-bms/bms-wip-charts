import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const sources = {
  index: read("docs/index.html"),
  listHtml: read("docs/list.html"),
  listJs: read("docs/list.js"),
  guide: read("docs/guide.html"),
  changelog: read("docs/changelog.html"),
  header: read("docs/site-header.js"),
  headerCss: read("docs/site-header.css"),
  theme: read("docs/theme-controller.js"),
  formError: read("docs/post-form-error-ui.js"),
  formReview: read("docs/post-form-review-ui.js"),
  formCss: read("docs/post-form-ui.css"),
  formUi: read("docs/post-form-ui.js"),
  branchAppend: read("docs/branch-append-ui.js"),
  app: read("docs/app.js"),
  listCss: read("docs/list.css"),
  branchCss: read("docs/branch-tree-list.css"),
  refreshCss: read("docs/list-ui-refresh.css"),
  commentCss: read("docs/version-comment-ui.css"),
  commentUi: read("docs/version-comment-ui.js"),
  managementCss: read("docs/version-management-ui.css"),
  links: read("docs/version-link-ui.js"),
  actions: read("docs/version-action-ui.js"),
  management: read("docs/version-management-ui.js"),
  rc: read("worker/src/utils/difficultyTableHtml.ts")
};

let passed = 0;
function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

check("RC links remain separate in the public header", () => {
  assert.match(sources.header, /key: "rc-star"/u);
  assert.match(sources.header, /key: "rc-double-star"/u);
});
check("header uses the accepted guide and post labels", () => {
  assert.match(sources.header, /label: "\\u4f7f\\u3044\\u65b9"/u);
  assert.match(sources.header, /label: "\\u6295\\u7a3f\\u3059\\u308b"/u);
});
check("theme control is labeled テーマ", () => assert.match(sources.theme, /labelText\.textContent = "テーマ"/u));
check("responsive menu closes above 1024px", () => assert.match(sources.header, /window\.innerWidth > 1024/u));
check("current navigation has color and underline", () => {
  assert.match(sources.headerCss, /\.site-navigation a\[aria-current\][^{]*\{[^}]*border-bottom-color: var\(--primary\);[^}]*color: var\(--primary\);/su);
});
check("home hero explains the service", () => {
  assert.match(sources.index, /全差分作者が求めていた/u);
  assert.match(sources.index, /没譜面・未完成譜面の専用投稿サイト/u);
  assert.match(sources.index, /追記機能・難易度表機能つき/u);
  assert.doesNotMatch(sources.index, /未完成譜面・没譜面を共有する/u);
});
check("hero keeps one primary action", () => assert.equal((sources.index.match(/recycle-cta-primary/gu) || []).length, 1));
check("recent list load-more remains", () => assert.match(sources.index, /id="loadMoreChartsButton"/u));
check("form exposes six accepted section headings", () => {
  for (const label of ["譜面ファイル", "楽曲情報", "差分情報", "進捗と投稿状態", "投稿後の管理", "内容確認"]) {
    assert.ok(sources.index.includes(label), label);
  }
});
check("optional fields are grouped in details", () => {
  assert.match(sources.index, /<details class="optional-fields" id="optionalSongFields">/u);
  for (const id of ["subtitle", "subartist", "originUrl"]) assert.match(sources.index, new RegExp(`id="${id}"`, "u"));
});
check("optional values open their details", () => assert.match(sources.formReview, /optionalFields\.open = \["subtitle", "subartist", "originUrl"\]\.some/u));
check("difficulty selection is two-step", () => {
  assert.match(sources.index, /1\. 難易度表の種類/u);
  assert.match(sources.index, /2\. 数値/u);
  assert.match(sources.index, /その他・手入力/u);
});
check("difficulty selected state has a non-color check", () => assert.match(sources.formCss, /content: "✓ ";/u));
check("difficulty selection never collapses into a summary", () => {
  assert.match(sources.app, /function collapseDifficultyPickerIfSelected\(\) \{\s*setDifficultyPickerExpanded\(true\);\s*return false;/u);
  assert.match(sources.app, /difficultyCompact\.hidden = true;/u);
});
check("post form reveals later sections only after file selection", () => {
  assert.equal((sources.index.match(/data-post-requires-file hidden/gu) || []).length, 5);
  assert.match(sources.formUi, /function syncDeferredSections\(\)/u);
  assert.match(sources.formUi, /section\.hidden = !hasSelectedFile/u);
});
check("append file change reaches the shared section reveal handler", () => {
  const handler = sources.branchAppend.match(/fileInput\?\.addEventListener\("change", \(\) => \{[\s\S]*?\n  \}, true\);/u)?.[0] || "";
  assert.match(handler, /handleAppendFileChange\(fileInput\.files\?\.\[0\]\)/u);
  assert.doesNotMatch(handler, /stopImmediatePropagation/u);
});
check("append mode offers incomplete and completed status radios without a completion button", () => {
  assert.match(sources.index, /id="submissionStateIncomplete"[^>]*type="radio"/u);
  assert.match(sources.index, /id="submissionStateCompleted"[^>]*type="radio"/u);
  assert.doesNotMatch(sources.index, /id="completeProgressButton"/u);
  assert.match(sources.branchAppend, /submissionStateIncomplete\?\.addEventListener\("change"/u);
  assert.match(sources.branchAppend, /submissionStateCompleted\?\.addEventListener\("change"/u);
});
check("post form tooltip keeps viewport positioning after section reveal", () => {
  assert.match(sources.formCss, /\.form-section\[data-post-requires-file\]:not\(\[hidden\]\) \{\s*animation: post-section-reveal 160ms ease-out;\s*\}/u);
  assert.doesNotMatch(sources.formCss, /animation: post-section-reveal[^;]*(?:both|forwards)/u);
  assert.match(sources.index, /\.\/post-form-ui\.css\?v=progress-tooltip-radio-inset-01/u);
});
check("submission state choices keep a five pixel inline inset", () => {
  assert.match(sources.formCss, /\.submission-state-choice \{[^}]*padding-inline-start: 5px;/su);
});
check("rejected completion immediately explains 100 percent", () => assert.match(sources.formReview, /進捗を100%として投稿します。/u));
check("review summary contains all accepted fields", () => {
  for (const label of ["ファイル", "曲名", "差分名", "作者", "難易度", "投稿状態", "進捗", "追記受付", "管理パスワード"]) {
    assert.ok(sources.formReview.includes(`label: "${label}"`), label);
  }
});
check("review summary never renders a password body", () => {
  assert.match(sources.formReview, /valueOf\("password"\) \? "設定済み" : "未設定"/u);
  assert.doesNotMatch(sources.formReview, /post-review-value[^\n]*password/u);
});
check("review change controls reveal and focus fields", () => {
  assert.match(sources.formReview, /dataset\.reviewTarget/u);
  assert.match(sources.formReview, /scrollIntoView/u);
  assert.match(sources.formReview, /\.focus\(/u);
});
check("submit button uses accepted action label", () => assert.match(sources.index, />この内容で投稿する<\/button>/u));
check("error summary lists clickable field errors", () => {
  assert.match(sources.formError, /post-error-summary-list/u);
  assert.match(sources.formError, /dataset\.postErrorTarget/u);
  assert.match(sources.formError, /void revealGeneral\(\)/u);
});
check("public origin control is labeled 原曲", () => assert.match(sources.links, /: "原曲"/u));
check("public version action is labeled 削除", () => {
  assert.match(sources.actions, /button\.textContent = "削除"/u);
  assert.match(sources.actions, /削除確認を開く/u);
  assert.doesNotMatch(`${sources.index}\n${sources.listHtml}\n${sources.actions}`, /投稿操作/u);
});
check("public dialog heading is 削除確認", () => {
  assert.match(sources.index, /id="versionManagementTitle">削除確認/u);
  assert.match(sources.listHtml, /id="versionManagementTitle">削除確認/u);
  assert.match(sources.management, /`削除確認: \$\{state\.versionLabel\}`/u);
});
check("DL label remains unchanged", () => {
  assert.match(sources.links, /control\.textContent = "DL"/u);
  assert.match(sources.rc, />DL<\/a>/u);
});
check("list has first-stage status options", () => {
  for (const value of ["all", "incomplete", "finished"]) assert.match(sources.listHtml, new RegExp(`name="compactStatusGroup" value="${value}"`, "u"));
});
check("list has completed subtypes", () => {
  for (const value of ["finished", "complete", "rejected"]) assert.match(sources.listHtml, new RegExp(`name="compactFinishedStatus" value="${value}"`, "u"));
});
check("list preserves all five API status values", () => assert.match(sources.listJs, /\["all", "incomplete", "complete", "rejected", "finished"\]/u));
check("date range is an advanced details control", () => assert.match(sources.listHtml, /<details class="compact-date-filter-row"[^>]*>[\s\S]*<summary[^>]*>期間を指定<\/summary>/u));
check("active filters support individual and all clearing", () => {
  assert.match(sources.listJs, /dataset\.clearFilter = filter\.key/u);
  assert.match(sources.listJs, /clearAll\.textContent = "すべて解除"/u);
});
check("list result header has six semantic regions", () => {
  const headings = [
    ["date", "投稿日"],
    ["chart", "譜面"],
    ["meta", "難易度・作者"],
    ["progress", "進捗"],
    ["comment", "コメント"],
    ["actions", "操作"]
  ];
  for (const [suffix, label] of headings) {
    assert.match(sources.listHtml, new RegExp(`<span(?: id="compactDateHeading")? class="list-heading-${suffix}">${label}<\\/span>`, "u"));
  }
});
check("list row keeps DL in its action region", () => assert.match(sources.listJs, /compact-links compact-actions-cell[^\n]*\$\{originControl\}\$\{downloadControl\}/u));
check("list row exposes the accepted five-action sequence", () => {
  assert.match(sources.listJs, /\$\{originControl\}\$\{downloadControl\}\$\{appendControl\}\$\{commentControl\}\$\{managementControl\}/u);
  assert.match(sources.listCss, /PUBLIC-UI-TOUCHUP-AND-CHANGELOG-03-PATCH1[\s\S]*display: grid;[\s\S]*"origin download append"[\s\S]*"comment comment delete"[\s\S]*repeat\(2, 32px\)/u);
  assert.match(sources.branchCss, /VERSION-ROW-LAYOUT-PATCH-02[\s\S]*display: grid;[\s\S]*"origin download append"[\s\S]*"comment comment delete"[\s\S]*repeat\(2, 32px\)/u);
  assert.match(sources.listCss, /@media \(max-width: 820px\)[\s\S]*"origin download"[\s\S]*"append append"[\s\S]*"comment delete"/u);
  assert.match(sources.listCss, /@media \(max-width: 820px\)[\s\S]*\.compact-actions-cell > \.compact-field-label \{[\s\S]*display: none;/u);
});
check("public list density keeps desktop height and responsive action limits", () => {
  assert.match(sources.listCss, /PUBLIC-UI-TOUCHUP-AND-CHANGELOG-03-PATCH1/u);
  assert.match(sources.listCss, /\.compact-version-row \{[\s\S]*min-height: 88px;[\s\S]*padding: 10px 12px;/u);
  assert.match(sources.refreshCss, /\.version-row\.version-tree-row \{[\s\S]*min-height: 88px;[\s\S]*padding: 10px 12px;[\s\S]*row-gap: 4px;/u);
  assert.match(sources.branchCss, /@media \(min-width: 761px\) and \(max-width: 1179px\)[\s\S]*width: 100%;/u);
});
check("comment previews use two plus one lines and remove empty regions", () => {
  assert.match(sources.commentCss, /\.author-comment-preview-text \{[\s\S]*-webkit-line-clamp: 2;[\s\S]*font-size: 0\.875rem;[\s\S]*font-weight: 500;[\s\S]*line-height: 1\.5;[\s\S]*max-height: 3em;/u);
  assert.match(sources.commentCss, /\.version-comment-latest-text \{[\s\S]*-webkit-line-clamp: 1;[\s\S]*font-size: 0\.85rem;[\s\S]*line-height: 1\.45;[\s\S]*max-height: 1\.45em;/u);
  assert.match(sources.commentCss, /\.author-comment-full-button \{[\s\S]*grid-column: 2;[\s\S]*position: static;[\s\S]*text-decoration: underline;/u);
  assert.match(sources.commentUi, /container\.hidden = !hasAuthorComment && !hasLatestComment/u);
  assert.match(sources.commentUi, /const empty = createElement\("span", "author-comment-empty", "—"\);[\s\S]*empty\.hidden = true;/u);
});
check("comment width and intrinsic desktop actions are balanced", () => {
  assert.match(sources.managementCss, /minmax\(300px, 1\.7fr\) minmax\(185px, 0\.8fr\)/u);
  assert.match(sources.listCss, /70px minmax\(360px, 2\.1fr\) minmax\(154px, max-content\)/u);
  assert.match(sources.actions, /button\.textContent = "追記";[\s\S]*aria-label", "追記投稿を開始"/u);
  assert.match(sources.actions, /label\.textContent = "💬";[\s\S]*label\.setAttribute\("aria-hidden", "true"\)/u);
  assert.match(sources.actions, /`コメントを開く、\$\{count\}件（\$\{versionLabel\}）`/u);
});
check("list deletion remains outline until confirmation", () => {
  assert.match(sources.managementCss, /button\.secondary\.version-management-button \{[\s\S]*background: transparent;[\s\S]*border: 1px solid var\(--danger\);/u);
  assert.match(sources.managementCss, /button\.version-withdrawal-action-button \{[\s\S]*background: var\(--danger\);/u);
});
check("completed subtype row keeps reserved layout height", () => {
  assert.match(sources.listCss, /\.compact-finished-subtypes\[hidden\][\s\S]*display: grid !important;[\s\S]*visibility: hidden;/u);
  assert.match(sources.listJs, /finishedSubtypes\.setAttribute\("aria-hidden", String\(!showFinishedSubtypes\)\)/u);
});
check("list summary consistently uses 件", () => {
  assert.doesNotMatch(sources.listJs, /版中|版を表示|0版/u);
  assert.match(sources.listJs, /件中/u);
});
check("list pagination keeps previous pages next and page count", () => {
  for (const token of [">前へ<", ">次へ<", "ページ"]) assert.ok(sources.listJs.includes(token));
});
check("guide uses the accepted structure", () => {
  for (const label of ["このサイトでできること", "最短手順", "詳しい使い方", "投稿管理", "安全案内"]) assert.ok(sources.guide.includes(label));
});
check("guide replaces the old wording", () => {
  assert.doesNotMatch(sources.guide, /確認＆編集/u);
  assert.match(sources.guide, /確認し、必要なら修正/u);
});
check("guide extensions remain lowercase", () => {
  assert.match(sources.guide, /bms・bme・bml、またはzip/u);
  assert.doesNotMatch(sources.guide, /BMS・BME・BML/u);
});
check("guide slash links are separate navigation links", () => assert.match(sources.guide, /class="guide-inline-links"/u));
check("changelog remains a flat article list", () => {
  assert.ok((sources.changelog.match(/<article class="changelog-entry" data-copy-entry=/gu) || []).length >= 1);
  assert.doesNotMatch(sources.changelog, /<details|最新.*badge|changelog-month/u);
});
check("changelog includes the 2026-08-05 form usability update", () => {
  assert.match(sources.changelog, /data-copy-entry="CHANGELOG_20260805"[\s\S]*進捗マップの小節・時間・ノーツ情報を、カーソルの近くへ表示するよう修正しました。/u);
  assert.match(sources.changelog, /data-copy-entry="CHANGELOG_20260805"[\s\S]*投稿状態の選択ボタンに左余白を加え、枠へ重ならないよう調整しました。/u);
  assert.match(sources.changelog, /data-copy-entry="CHANGELOG_20260805"[\s\S]*トップページの投稿カードと投稿一覧を圧縮し、コメント・進捗・操作を保ったまま多くの投稿を見渡せるようにしました。/u);
});
check("comment and action assets share a release cache key", () => {
  for (const asset of ["style.css", "branch-tree-list.css", "version-comment-ui.css"]) {
    assert.match(sources.index, new RegExp(`\\./${asset.replaceAll(".", "\\.")}\\?v=public-ui-touchup-03-patch1`, "u"));
  }
  assert.match(sources.index, /\.\/version-management-ui\.css\?v=public-ui-touchup-03-patch1/u);
  assert.match(sources.index, /\.\/version-action-ui\.js\?v=comment-action-balance-01/u);
  for (const asset of ["style.css", "list.css", "version-comment-ui.css"]) {
    assert.match(sources.listHtml, new RegExp(`\\./${asset.replaceAll(".", "\\.")}\\?v=public-ui-touchup-03-patch1`, "u"));
  }
  assert.match(sources.listHtml, /\.\/version-management-ui\.css\?v=public-ui-touchup-03-patch1/u);
  assert.match(sources.listHtml, /\.\/version-action-ui\.js\?v=comment-action-balance-01/u);
  assert.match(sources.index, /\.\/list-ui-refresh\.css\?v=public-list-density-patch-01/u);
  assert.match(sources.listHtml, /\.\/list\.js\?v=public-ui-touchup-03-patch1/u);
});
check("guide and changelog share the widened content measure", () => assert.match(sources.headerCss, /\.content-page \{\s*max-width: min\(100%, 114ch\);/u));
check("RC header has top, title, switch and theme", () => {
  const template = sources.rc.slice(sources.rc.indexOf('<header class="page-header">'), sources.rc.indexOf('</header>') + 9);
  assert.ok(template.indexOf("renderHomeLink") < template.indexOf("<h1"));
  assert.ok(template.indexOf("<h1") < template.indexOf("renderSwitches"));
  assert.match(sources.rc, /aria-label="テーマの切替"/u);
});
check("RC uses accepted intro and action labels", () => {
  assert.match(sources.rc, /完成版と完成済み没譜面を掲載しています。/u);
  assert.match(sources.rc, />原曲<\/a>/u);
  assert.match(sources.rc, /<summary aria-label="コメント" title="コメントを表示">💬<\/summary>/u);
});
check("RC comment icon exposes hover focus and active states", () => {
  assert.match(sources.rc, /\.row-comment summary:hover/u);
  assert.match(sources.rc, /\.row-comment summary:focus-visible/u);
  assert.match(sources.rc, /\.row-comment summary:active/u);
});
check("RC resource feeds are inside details", () => assert.match(sources.rc, /<details class="resource-links"><summary>難易度表の取込用リンク<\/summary>/u));
check("RC empty state links home and list", () => assert.match(sources.rc, /投稿一覧を見る/u));
check("RC error state includes a retry link", () => assert.match(sources.rc, /このページを再読み込み/u));
check("RC actions keep desktop and mobile target sizes", () => {
  assert.match(sources.rc, /\.action-link \{[\s\S]*min-height: 40px;/u);
  assert.match(sources.rc, /\.switch-link, \.action-link, \.row-comment summary \{ min-width: 44px; min-height: 44px; \}/u);
});
check("global theme tokens include the required hierarchy", () => {
  const themeCss = read("docs/theme.css");
  for (const token of ["--bg", "--surface", "--surface-muted", "--text", "--muted", "--line", "--line-strong", "--primary", "--primary-hover", "--primary-soft", "--success", "--warning", "--danger", "--info", "--focus-ring", "--disabled-bg", "--disabled-text"]) assert.ok(themeCss.includes(token));
});
check("public controls use 40 and 44px targets", () => {
  assert.match(sources.headerCss, /min-height: 40px/u);
  assert.match(sources.headerCss, /min-height: 44px/u);
  assert.match(sources.listCss, /min-height: 44px/u);
});
check("spec records the accepted public UI patch contract", () => assert.match(read("project-docs/SPEC.md"), /## PUBLIC-UI-REFINEMENT-PATCH-02/u));

console.log(`PUBLIC_UI_REFINEMENT_TESTS ${passed}/${passed}`);
