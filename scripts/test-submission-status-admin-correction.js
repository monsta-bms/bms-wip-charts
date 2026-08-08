"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const files = {
  index: read("docs/index.html"),
  app: read("docs/app.js"),
  submission: read("docs/submission-status-ui.js"),
  branchAppend: read("docs/branch-append-ui.js"),
  postCss: read("docs/post-form-ui.css"),
  admin: read("docs/admin.html"),
  adminJs: read("docs/admin-status.js"),
  adminCss: read("docs/admin.css"),
  charts: read("worker/src/routes/charts.ts"),
  chartVersions: read("worker/src/routes/chartVersions.ts"),
  adminRoute: read("worker/src/routes/adminVersionStatus.ts"),
  progressMap: read("worker/src/utils/progressMap.ts"),
  difficultyHtml: read("worker/src/utils/difficultyTableHtml.ts"),
  guide: read("docs/guide.html"),
  changelog: read("docs/changelog.html")
};

let passed = 0;
function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

check("初期選択は制作途中", () => {
  assert.match(files.index, /id="submissionStateIncomplete"[^>]*type="radio"[^>]*checked/u);
});
check("制作途中の説明文", () => assert.ok(files.index.includes("制作途中の譜面として投稿します。")));
check("完成版を表示", () => assert.match(files.index, /id="submissionStateCompleted"/u));
check("初回完成版はdisabled", () => assert.match(files.index, /id="submissionStateCompleted"[^>]*disabled/u));
check("初回完成版の説明文", () => assert.ok(files.index.includes("初回投稿では完成版にできません。")));
check("完成済み没譜面を選択可能", () => assert.match(files.index, /id="submissionStateRejected"[^>]*type="radio"/u));
check("完成済み没譜面の説明文", () => assert.ok(files.index.includes("完成済みの没譜面として投稿します。")));
check("旧没譜面checkboxを表示しない", () => assert.doesNotMatch(files.index, /id="isRejected"[^>]*type="checkbox"/u));
check("互換isRejectedはhidden", () => assert.match(files.index, /id="isRejected"[^>]*type="hidden"/u));
check("radioは同じnameで排他的", () => assert.equal((files.index.match(/name="submissionState"/gu) || []).length, 3));
check("選択状態を視覚表示", () => assert.match(files.postCss, /submission-state-row\[data-selected="true"\]/u));
check("keyboard操作はnative radio", () => assert.match(files.submission, /addEventListener\("change"/u));
check("制作途中でisRejected false", () => assert.match(files.submission, /nextRejected = selectedState\(\) === "rejected_completed"/u));
check("完成済み没譜面でisRejected true", () => assert.match(files.submission, /rejected\.checked/u));
check("没譜面の初期追記受付はON", () => assert.match(files.app, /initialRejectedChoice = true/u));
check("制作途中の追記受付はON固定", () => assert.match(files.app, /effectiveAllowAppend: isAllowAppendConfigurable \? allowAppendUserChoice : true/u));
check("没譜面progressは100", () => assert.match(files.app, /formData\.append\("progress", isRejectedInput\.checked \? "100"/u));
check("没譜面選択前snapshotを保存", () => assert.match(files.app, /savedPaintedBlockIndexes = new Set/u));
check("没譜面選択前progressを保存", () => assert.match(files.app, /savedProgressValue = progressInput\.value/u));
check("制作途中復帰時snapshotを復元", () => assert.match(files.app, /paintedBlockIndexes = new Set\(progressMapState\.savedPaintedBlockIndexes\)/u));
check("snapshotなしの制作途中は安全な0%", () => assert.match(files.app, /progressInput\.value = "0"/u));
check("resetで制作途中へ戻る", () => assert.match(files.submission, /form\.addEventListener\("reset"[\s\S]*incomplete\.checked = true/u));
check("狭幅向けCSSを維持", () => assert.match(files.postCss, /@media \(max-width:/u));
check("投稿状態操作領域44px", () => assert.match(files.postCss, /submission-state-choice[\s\S]*min-height: 44px/u));

check("初回通常完成をWorkerが拒否", () => assert.match(files.charts, /INITIAL_COMPLETION_NOT_ALLOWED/u));
check("初回制作途中progress100をWorkerが拒否", () => assert.match(files.charts, /!input\.isRejected && preparedProgressMap\.progress === 100/u));
check("初回制作途中allowAppend falseをWorkerが拒否", () => assert.match(files.charts, /!isRejected && !allowAppend\.value[\s\S]*APPEND_POLICY_LOCKED_FOR_INCOMPLETE/u));
check("初回没譜面はWorkerでprogress100", () => assert.match(files.charts, /storedProgress = isRejected \? 100 : progress\.value/u));
check("初回没譜面allowAppendを指定可能", () => assert.match(files.charts, /parseAllowAppend\(form, !isRejected\)/u));
check("追記没譜面を拒否", () => assert.match(files.chartVersions, /FOLLOWUP_REJECTED_NOT_ALLOWED/u));
check("追記完成指定を維持", () => assert.match(files.chartVersions, /completionRequested/u));
check("append mode enables incomplete and completed radio choices", () => {
  assert.match(files.submission, /incomplete\.disabled = false/u);
  assert.match(files.submission, /completed\.disabled = !append/u);
  assert.match(files.submission, /rejected\.disabled = append/u);
  assert.match(files.submission, /if \(completed\.checked && isAppendMode\(\)\) return "completed"/u);
});
check("append completion uses the completed radio instead of a separate button", () => {
  assert.doesNotMatch(`${files.index}\n${files.app}\n${files.branchAppend}`, /completeProgressButton/u);
  assert.match(files.branchAppend, /submissionStateCompleted\?\.addEventListener\("change"/u);
  assert.match(files.branchAppend, /setAppendCompletion\(true\)/u);
});
check("completed radio fills every unpainted append block without an 80 percent gate", () => {
  assert.match(files.branchAppend, /appendState\.layerKind = "completion_fill"[\s\S]*appendState\.currentPainted\.add\(block\.index\)/u);
  assert.doesNotMatch(files.branchAppend, /calculateProgress\(\)\s*<\s*80/u);
  assert.doesNotMatch(files.progressMap, /completionBaseProgress\s*<\s*80/u);
});

check("管理画面sectionを追加", () => assert.ok(files.admin.includes("投稿状態の修正")));
check("要確認のみ初期ON", () => assert.match(files.admin, /id="adminVersionStatusSuspiciousOnly"[^>]*checked/u));
check("検索・filter・paginationを実装", () => {
  for (const id of ["adminVersionStatusQuery", "adminVersionStatusState", "adminVersionStatusPrevious", "adminVersionStatusNext"]) {
    assert.ok(files.admin.includes(id));
  }
});
check("dialogに変更前と変更後を表示", () => {
  assert.ok(files.admin.includes("adminVersionStatusBefore"));
  assert.ok(files.admin.includes("adminVersionStatusAfter"));
});
check("管理UIは既存認証helperを再利用", () => assert.match(files.adminJs, /window\.adminApiRequest/u));
check("管理UIは二重送信を防止", () => assert.match(files.adminJs, /state\.submitting/u));
check("dialog focusを復帰", () => assert.match(files.adminJs, /returnFocus\?\.focus/u));
check("要確認理由A-Fを実装", () => {
  for (const code of [
    "REJECTED_WITH_INCOMPLETE_PROGRESS_MAP",
    "INCOMPLETE_WITH_FULL_PROGRESS",
    "COMPLETED_WITH_NON_FULL_PROGRESS",
    "REJECTED_WITH_COMPLETED_AT",
    "REJECTED_WITH_NON_FULL_PROGRESS",
    "PROGRESS_MAP_MISMATCH"
  ]) assert.ok(files.adminRoute.includes(code), code);
});
check("管理一覧APIを実装", () => assert.match(files.adminRoute, /listAdminVersionStatuses/u));
check("管理PATCH APIを実装", () => assert.match(files.adminRoute, /updateAdminVersionStatus/u));
check("expectedUpdatedAt競合検出", () => assert.match(files.adminRoute, /ADMIN_VERSION_STATE_CONFLICT/u));
check("hidden・deleted・withdrawal pendingを更新不可", () => {
  assert.match(files.adminRoute, /is_hidden = 0/u);
  assert.match(files.adminRoute, /file_deleted_at IS NULL/u);
  assert.match(files.adminRoute, /'pending', 'processing', 'tombstoned', 'deleted'/u);
});
check("状態更新はD1 batch transaction", () => assert.match(files.adminRoute, /env\.DB\.batch\(\[targetUpdate, reconciliation, chartUpdate, adminLog\]\)/u));
check("admin log actionを固定", () => assert.match(files.adminRoute, /correct_version_submission_state/u));
check("共通progress map utilityを利用", () => assert.match(files.adminRoute, /normalizeStoredProgressMapForSubmissionState/u));
check("完成と没譜面のmap kindを正規化", () => {
  assert.ok(files.progressMap.includes("completion_fill"));
  assert.ok(files.progressMap.includes("rejected_auto_fill"));
});
check("管理画面390px対応", () => assert.match(files.adminCss, /@media \(max-width: 620px\)[\s\S]*admin-version-status/u));

check("RCトップURLを一度だけ定義", () => {
  assert.equal((files.difficultyHtml.match(/https:\/\/monsta-bms\.github\.io\/bms-wip-charts\//gu) || []).length, 1);
});
check("RCトップリンクを共通helperで生成", () => assert.match(files.difficultyHtml, /function renderHomeLink/u));
check("RCトップリンクは同じtab", () => assert.doesNotMatch(files.difficultyHtml, /class="home-link"[^>]*target=/u));
check("RCトップリンクは44px", () => assert.match(files.difficultyHtml, /\.home-link[\s\S]*min-height: 44px/u));
check("error HTMLにもトップリンク", () => assert.match(files.difficultyHtml, /buildDifficultyTableErrorHtml[\s\S]*renderHomeLink/u));

check("ガイドに4ルールを追記", () => {
  for (const text of ["初回投稿では", "通常の完成版は追記投稿から", "追記受付が必須", "追記受付をON／OFFから選べます"]) {
    assert.ok(files.guide.includes(text), text);
  }
});
check("2026-08-04更新履歴を追加", () => assert.match(files.changelog, /CHANGELOG_20260804/u));

console.log(`submission status admin correction static tests: ${passed} passed`);
