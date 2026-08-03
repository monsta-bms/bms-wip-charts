"use strict";

const assert = require("node:assert/strict");
const {
  buildVersionUiModel,
  normalizeExternalHttpUrl,
  normalizeWorkerDownloadUrl,
  normalizeLifecycleState
} = require("../docs/version-ui-model.js");

const WORKER_BASE_URL = "https://worker.example.test";
let passed = 0;

function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function version(overrides = {}) {
  return {
    id: "version_01",
    lifecycleStatus: "active",
    handlingMode: null,
    hidden: false,
    downloadBlocked: false,
    allowAppend: true,
    originUrl: "https://songs.example.test/original",
    file: { downloadUrl: "/api/files/File_AbC-123" },
    ...overrides
  };
}

function model(overrides = {}, options = {}) {
  return buildVersionUiModel(version(overrides), {
    workerBaseUrl: WORKER_BASE_URL,
    hasProgressMap: true,
    ...options
  });
}

function allReasons(uiModel) {
  return [
    uiModel.actionReason,
    uiModel.originLink.reason,
    uiModel.download.reason,
    uiModel.append.reason,
    uiModel.management.reason,
    uiModel.favorite.reason,
    uiModel.comments.reason
  ];
}

check("active lifecycle is known", () => {
  assert.equal(normalizeLifecycleState("active"), "active");
  assert.equal(model().lifecycle.known, true);
});
check("withdrawal_pending grace lifecycle stays operable", () => {
  const result = model({ lifecycleStatus: "withdrawal_pending", handlingMode: "grace_auto_delete" });
  assert.equal(result.canShowActions, true);
  assert.equal(result.lifecycle.label, "DL停止・自動削除待ち");
});
check("withdrawal_pending manual lifecycle stays operable", () => {
  const result = model({ lifecycleStatus: "withdrawal_pending", handlingMode: "manual_review" });
  assert.equal(result.canShowActions, true);
  assert.equal(result.lifecycle.label, "DL停止・管理者確認待ち");
});
check("processing lifecycle is blocked", () => {
  assert.equal(model({ lifecycleStatus: "processing" }).actionReason, "lifecycle_blocked");
});
check("tombstoned lifecycle is blocked", () => {
  assert.equal(model({ lifecycleStatus: "tombstoned" }).canShowActions, false);
});
check("deleted lifecycle is blocked", () => {
  assert.equal(model({ lifecycleStatus: "deleted" }).canShowActions, false);
});
check("unknown lifecycle string fails closed", () => {
  const result = model({ lifecycleStatus: "future_state" });
  assert.equal(result.lifecycle.state, "unknown");
  assert.equal(result.canShowActions, false);
});
check("missing lifecycle fails closed", () => {
  const input = version();
  delete input.lifecycleStatus;
  assert.equal(buildVersionUiModel(input, { workerBaseUrl: WORKER_BASE_URL, hasProgressMap: true }).canShowActions, false);
});
check("null lifecycle fails closed", () => {
  assert.equal(model({ lifecycleStatus: null }).lifecycle.state, "unknown");
});
check("non-string lifecycle fails closed", () => {
  assert.equal(model({ lifecycleStatus: 123 }).canShowActions, false);
});
check("legacy withdrawn is recognized but not operable", () => {
  const result = model({ lifecycleStatus: "legacy_withdrawn" });
  assert.equal(result.lifecycle.known, true);
  assert.equal(result.canShowActions, false);
});

check("missing version ID fails closed", () => {
  const input = version();
  delete input.id;
  assert.equal(buildVersionUiModel(input, { workerBaseUrl: WORKER_BASE_URL, hasProgressMap: true }).actionReason, "missing_version_id");
});
check("hidden version fails closed", () => {
  assert.equal(model({ hidden: true }).actionReason, "hidden");
});
check("redacted version fails closed", () => {
  assert.equal(model({ publicDataRedacted: true }).actionReason, "redacted");
});
check("normal active version exposes actions", () => {
  const result = model();
  assert.equal(result.canShowActions, true);
  assert.equal(result.management.visible, true);
  assert.equal(result.favorite.available, true);
  assert.equal(result.comments.available, true);
});
check("missing comment summary remains backward-compatible", () => {
  const result = model();
  assert.equal(result.comments.count, 0);
  assert.equal(result.comments.latest, null);
});
check("comment count and latest comment are normalized", () => {
  const result = model({
    commentCount: 3,
    latestComment: { body: "latest comment", createdAt: "2026-08-03 00:00:00" }
  });
  assert.deepEqual(result.comments, {
    available: true,
    count: 3,
    latest: { body: "latest comment", createdAt: "2026-08-03 00:00:00" },
    reason: "available"
  });
});
check("snake-case comment summary aliases are supported", () => {
  const result = model({
    comment_count: 1,
    latest_comment: { body: "alias", created_at: "2026-08-03 00:00:01" }
  });
  assert.equal(result.comments.count, 1);
  assert.deepEqual(result.comments.latest, { body: "alias", createdAt: "2026-08-03 00:00:01" });
});
check("invalid comment summary fails to safe empty values", () => {
  const result = model({ commentCount: -1, latestComment: { body: "", createdAt: 1 } });
  assert.equal(result.comments.count, 0);
  assert.equal(result.comments.latest, null);
});
check("redacted version does not expose public comment action", () => {
  const result = model({ publicDataRedacted: true, commentCount: 9 });
  assert.equal(result.comments.available, false);
  assert.equal(result.comments.reason, "redacted");
});
check("contradictory active handling mode fails closed", () => {
  assert.equal(model({ handlingMode: "manual_review" }).actionReason, "inconsistent_data");
});
check("contradictory explicit download availability fails closed", () => {
  assert.equal(model({ downloadBlocked: true, downloadAvailable: true }).actionReason, "inconsistent_data");
});

check("HTTPS origin URL is accepted", () => {
  assert.equal(normalizeExternalHttpUrl("https://example.test/song"), "https://example.test/song");
});
check("HTTP origin URL is accepted", () => {
  assert.equal(normalizeExternalHttpUrl("http://example.test/song"), "http://example.test/song");
});
check("javascript origin URL is rejected", () => {
  assert.equal(normalizeExternalHttpUrl("javascript:alert(1)"), null);
});
check("data origin URL is rejected", () => {
  assert.equal(normalizeExternalHttpUrl("data:text/plain,test"), null);
});
check("relative origin URL is rejected", () => {
  assert.equal(normalizeExternalHttpUrl("/song"), null);
});
check("credentialed origin URL is rejected", () => {
  assert.equal(normalizeExternalHttpUrl("https://user:pass@example.test/song"), null);
});
check("malformed origin URL is rejected", () => {
  assert.equal(normalizeExternalHttpUrl("https://[invalid"), null);
});
check("empty origin URL is rejected", () => {
  assert.equal(normalizeExternalHttpUrl(""), null);
});
check("origin link remains while download is blocked", () => {
  const result = model({ downloadBlocked: true, file: { downloadUrl: null } });
  assert.equal(result.originLink.available, true);
  assert.equal(result.download.available, false);
});
check("file and blob origin URLs are rejected", () => {
  assert.equal(normalizeExternalHttpUrl("file:///tmp/chart.bms"), null);
  assert.equal(normalizeExternalHttpUrl("blob:https://example.test/id"), null);
});

check("correct Worker absolute download URL is accepted", () => {
  assert.equal(
    normalizeWorkerDownloadUrl(`${WORKER_BASE_URL}/api/files/file-01`, WORKER_BASE_URL),
    `${WORKER_BASE_URL}/api/files/file-01`
  );
});
check("mixed-case file ID is preserved", () => {
  assert.equal(
    normalizeWorkerDownloadUrl("/api/files/AbC_xYz-09", WORKER_BASE_URL),
    `${WORKER_BASE_URL}/api/files/AbC_xYz-09`
  );
});
check("different download origin is rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("https://other.example.test/api/files/file", WORKER_BASE_URL), null);
});
check("non-files Worker path is rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("/api/progress-images/file", WORKER_BASE_URL), null);
});
check("empty file ID is rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("/api/files/", WORKER_BASE_URL), null);
});
check("javascript download URL is rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("javascript:alert(1)", WORKER_BASE_URL), null);
});
check("data download URL is rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("data:text/plain,test", WORKER_BASE_URL), null);
});
check("credentialed download URL is rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("https://user:pass@worker.example.test/api/files/file", WORKER_BASE_URL), null);
});
check("malformed download URL is rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("https://[invalid", WORKER_BASE_URL), null);
});
check("missing download URL is unavailable", () => {
  assert.equal(model({ file: { downloadUrl: null } }).download.reason, "missing_url");
});
check("administrative download block is unavailable", () => {
  assert.equal(model({ downloadBlocked: true }).download.reason, "download_blocked");
});
check("withdrawal download block is unavailable", () => {
  assert.equal(model({ withdrawalDownloadBlocked: true }).download.reason, "download_blocked");
});
check("processing blocks download", () => {
  assert.equal(model({ lifecycleStatus: "processing" }).download.available, false);
});
check("pending grace alone does not add a second download block", () => {
  const result = model({ lifecycleStatus: "withdrawal_pending", handlingMode: "grace_auto_delete" });
  assert.equal(result.download.available, true);
});
check("query and hash on download URLs are rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("/api/files/file?q=1", WORKER_BASE_URL), null);
  assert.equal(normalizeWorkerDownloadUrl("/api/files/file#part", WORKER_BASE_URL), null);
});
check("nested or trailing file paths are rejected", () => {
  assert.equal(normalizeWorkerDownloadUrl("/api/files/a/b", WORKER_BASE_URL), null);
  assert.equal(normalizeWorkerDownloadUrl("/api/files/a/", WORKER_BASE_URL), null);
});
check("missing download block state fails closed for download only", () => {
  const input = version();
  delete input.downloadBlocked;
  const result = buildVersionUiModel(input, { workerBaseUrl: WORKER_BASE_URL, hasProgressMap: true });
  assert.equal(result.canShowActions, true);
  assert.equal(result.download.reason, "download_state_unknown");
});

check("allowAppend true with progress map is available", () => {
  assert.equal(model().append.available, true);
});
check("allowAppend false shows stopped state", () => {
  const result = model({ allowAppend: false });
  assert.equal(result.append.label, "追記停止");
  assert.equal(result.append.reason, "append_disabled");
});
check("missing allowAppend fails closed", () => {
  const input = version();
  delete input.allowAppend;
  const result = buildVersionUiModel(input, { workerBaseUrl: WORKER_BASE_URL, hasProgressMap: true });
  assert.equal(result.append.available, false);
  assert.equal(result.append.reason, "invalid_allow_append");
});
check("string allowAppend fails closed", () => {
  assert.equal(model({ allowAppend: "true" }).append.reason, "invalid_allow_append");
});
check("numeric allowAppend fails closed", () => {
  assert.equal(model({ allowAppend: 1 }).append.reason, "invalid_allow_append");
});
check("missing progress map reports legacy format", () => {
  const result = model({}, { hasProgressMap: false });
  assert.equal(result.append.label, "旧形式");
  assert.equal(result.append.reason, "legacy_progress_map");
});
check("processing blocks append", () => {
  assert.equal(model({ lifecycleStatus: "processing" }).append.label, "追記不可");
});
check("tombstoned blocks append", () => {
  assert.equal(model({ lifecycleStatus: "tombstoned" }).append.available, false);
});
check("pending manual preserves append policy", () => {
  const result = model({ lifecycleStatus: "withdrawal_pending", handlingMode: "manual_review" });
  assert.equal(result.append.available, true);
});
check("collapsed intermediate version cannot append", () => {
  const result = model({ collapsedByCompletion: true });
  assert.equal(result.append.label, "追記不可");
  assert.equal(result.append.reason, "superseded_intermediate");
});

check("active enables management and favorite", () => {
  const result = model();
  assert.equal(result.management.visible, true);
  assert.equal(result.favorite.available, true);
});
check("pending enables management and favorite", () => {
  const result = model({ lifecycleStatus: "withdrawal_pending", handlingMode: "manual_review" });
  assert.equal(result.management.visible, true);
  assert.equal(result.favorite.available, true);
});
check("processing disables management and favorite", () => {
  const result = model({ lifecycleStatus: "processing" });
  assert.equal(result.management.visible, false);
  assert.equal(result.favorite.available, false);
});
check("tombstoned disables management and favorite", () => {
  const result = model({ lifecycleStatus: "tombstoned" });
  assert.equal(result.management.visible, false);
  assert.equal(result.favorite.available, false);
});
check("unknown disables management and favorite", () => {
  const result = model({ lifecycleStatus: "future" });
  assert.equal(result.management.visible, false);
  assert.equal(result.favorite.available, false);
});
check("redacted disables management and favorite", () => {
  const result = model({ publicDataRedacted: true });
  assert.equal(result.management.visible, false);
  assert.equal(result.favorite.available, false);
});
check("hidden disables management and favorite", () => {
  const result = model({ hidden: true });
  assert.equal(result.management.visible, false);
  assert.equal(result.favorite.available, false);
});

check("input version is not mutated", () => {
  const input = version({ file: { downloadUrl: "/api/files/immutable" } });
  const before = JSON.stringify(input);
  buildVersionUiModel(input, { workerBaseUrl: WORKER_BASE_URL, hasProgressMap: true });
  assert.equal(JSON.stringify(input), before);
});
check("returned model and nested records are frozen", () => {
  const result = model();
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.originLink), true);
  assert.equal(Object.isFrozen(result.download), true);
  assert.equal(Object.isFrozen(result.append), true);
  assert.equal(Object.isFrozen(result.lifecycle), true);
  assert.equal(Object.isFrozen(result.management), true);
  assert.equal(Object.isFrozen(result.favorite), true);
});
check("same input produces the same model", () => {
  assert.deepEqual(model(), model());
});
check("reason codes never contain user input", () => {
  const marker = "private-user-value-8472";
  const result = model({
    originUrl: marker,
    file: { downloadUrl: marker },
    allowAppend: "private-user-value-8472"
  });
  allReasons(result).forEach((reason) => assert.doesNotMatch(reason, new RegExp(marker)));
});
check("normal fixture control snapshot remains stable", () => {
  const result = model();
  const snapshot = [
    result.originLink.available ? `曲:${result.originLink.url}:_blank:noopener noreferrer` : "曲なし",
    `${result.download.label}:${result.download.url}`,
    result.append.label,
    result.management.visible ? "投稿管理" : "管理なし",
    result.favorite.available ? "favorite" : "favoriteなし",
    result.lifecycle.state
  ].join("|");
  assert.equal(
    snapshot,
    "曲:https://songs.example.test/original:_blank:noopener noreferrer|DL:https://worker.example.test/api/files/File_AbC-123|追記投稿|投稿管理|favorite|active"
  );
  assert.equal(Buffer.byteLength(snapshot, "utf8"), 162);
});
check("eight-version fixture builds exactly one model per version", () => {
  const fixture = Array.from({ length: 8 }, (_, index) => version({ id: `version_${index}` }));
  const NativeUrl = global.URL;
  let modelBuildCount = 0;
  let urlParseCount = 0;
  global.URL = class CountingUrl extends NativeUrl {
    constructor(value, base) {
      urlParseCount += 1;
      super(value, base);
    }
  };
  let results;
  try {
    results = fixture.map((item) => {
      modelBuildCount += 1;
      return buildVersionUiModel(item, { workerBaseUrl: WORKER_BASE_URL, hasProgressMap: true });
    });
  } finally {
    global.URL = NativeUrl;
  }
  assert.equal(modelBuildCount, fixture.length);
  assert.equal(urlParseCount, 24);
  assert.equal(results.every((item) => item.canShowActions), true);
});

assert.ok(passed >= 63, `expected at least 63 checks, got ${passed}`);
console.log(`version ui model tests: ${passed} checks passed`);
