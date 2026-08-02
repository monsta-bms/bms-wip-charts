import { createHash } from "node:crypto";

export const PURGE_ERROR_CODES = Object.freeze({
  manifestInvalid: "TEST_DATA_PURGE_MANIFEST_INVALID",
  approvalMissing: "TEST_DATA_PURGE_APPROVAL_MISSING",
  targetChanged: "TEST_DATA_PURGE_TARGET_CHANGED",
  backupFailed: "TEST_DATA_PURGE_BACKUP_FAILED",
  dryRunFailed: "TEST_DATA_PURGE_DRY_RUN_FAILED",
  d1Failed: "TEST_DATA_PURGE_D1_FAILED",
  r2Failed: "TEST_DATA_PURGE_R2_FAILED",
  partialR2: "TEST_DATA_PURGE_PARTIAL_R2_ORPHANS",
  verifyFailed: "TEST_DATA_PURGE_VERIFY_FAILED"
});

const TABLE_KEYS = Object.freeze([
  "charts",
  "versions",
  "songs",
  "version_withdrawals",
  "delete_requests",
  "post_logs",
  "version_source_metadata",
  "admin_logs",
  "bans"
]);

const ID_PATTERNS = Object.freeze({
  charts: /^chart_[0-9a-f-]{36}$/u,
  versions: /^version_[0-9a-f-]{36}$/u,
  songs: /^song_[0-9a-f-]{36}$/u,
  version_withdrawals: /^withdrawal_[0-9a-f-]{36}$/u,
  delete_requests: /^[a-z][a-z0-9_]*_[0-9a-f-]{36}$/u,
  post_logs: /^[a-z][a-z0-9_]*_[0-9a-f-]{36}$/u,
  version_source_metadata: /^version_[0-9a-f-]{36}$/u,
  admin_logs: /^[a-z][a-z0-9_]*_[0-9a-f-]{36}$/u,
  bans: /^[a-z][a-z0-9_]*_[0-9a-f-]{36}$/u
});

const SENSITIVE_LOG_PATTERN = /(?:authorization\s*:\s*bearer|password(?:_hash)?\s*[=:]|admin_token\s*[=:]|requester_(?:ip|ua)_hash\s*[=:]|\b[0-9a-f]{64}\b)/iu;

export class TestDataPurgeError extends Error {
  constructor(code, stage, detail = {}) {
    super(code);
    this.name = "TestDataPurgeError";
    this.code = code;
    this.stage = stage;
    this.detail = Object.freeze({ ...detail });
  }
}

function fail(code, stage, detail) {
  throw new TestDataPurgeError(code, stage, detail);
}

function asArray(value, field, code = PURGE_ERROR_CODES.manifestInvalid) {
  if (!Array.isArray(value)) fail(code, "manifest", { field });
  return value;
}

function uniqueStrings(value, field, pattern) {
  const values = asArray(value, field);
  if (values.some((entry) => typeof entry !== "string" || !pattern.test(entry))) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { field, reason: "invalid_id" });
  }
  if (new Set(values).size !== values.length) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { field, reason: "duplicate_id" });
  }
  return values;
}

function disjoint(left, right, field) {
  const rightSet = new Set(right);
  if (left.some((value) => rightSet.has(value))) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { field, reason: "keep_overlap" });
  }
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateManifest(manifest, { candidateBytes } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "not_object" });
  }
  if (manifest.schemaVersion !== 1 || typeof manifest.manifestId !== "string") {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "schema" });
  }
  if (manifest.approvalState !== "APPROVED"
    || typeof manifest.approvedAt !== "string"
    || !/^[0-9a-f]{64}$/u.test(String(manifest.approvedCandidateFileSha256 ?? ""))) {
    fail(PURGE_ERROR_CODES.approvalMissing, "approval", { reason: "approval_fields" });
  }
  if (candidateBytes && sha256Hex(candidateBytes) !== manifest.approvedCandidateFileSha256) {
    fail(PURGE_ERROR_CODES.approvalMissing, "approval", { reason: "candidate_hash" });
  }

  const chartIds = uniqueStrings(manifest.chartIds, "chartIds", ID_PATTERNS.charts);
  const versionIds = uniqueStrings(manifest.versionIds, "versionIds", ID_PATTERNS.versions);
  const songIds = uniqueStrings(manifest.songIds, "songIds", ID_PATTERNS.songs);
  const keepChartIds = uniqueStrings(manifest.keepChartIds, "keepChartIds", ID_PATTERNS.charts);
  const keepVersionIds = uniqueStrings(manifest.keepVersionIds, "keepVersionIds", ID_PATTERNS.versions);
  const fullPurge = manifest.purgeScope === "all_chart_data";
  if (chartIds.length === 0 || versionIds.length === 0) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "empty_target" });
  }
  disjoint(chartIds, keepChartIds, "chartIds");
  disjoint(versionIds, keepVersionIds, "versionIds");
  if (fullPurge && (keepChartIds.length !== 0 || keepVersionIds.length !== 0)) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "full_purge_keep_not_empty" });
  }

  const related = manifest.relatedRowIdsByTable;
  const counts = manifest.expectedRowCountsByTable;
  if (!related || !counts || typeof related !== "object" || typeof counts !== "object") {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "related_rows" });
  }
  for (const table of TABLE_KEYS) {
    const ids = uniqueStrings(related[table], `relatedRowIdsByTable.${table}`, ID_PATTERNS[table]);
    if (!Number.isInteger(counts[table]) || counts[table] < 0 || counts[table] !== ids.length) {
      fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { table, reason: "row_count" });
    }
  }

  const objectKeys = uniqueStrings(
    manifest.r2ExactObjectKeys,
    "r2ExactObjectKeys",
    /^charts\/chart_[0-9a-f-]{36}\/.+$/u
  );
  if (objectKeys.some((key) => /[*?\[\]]/u.test(key)
    || (!fullPurge && !chartIds.some((chartId) => key.startsWith(`charts/${chartId}/`))))) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "r2_key_scope" });
  }
  if (!Number.isInteger(manifest.expectedObjectCount)
    || manifest.expectedObjectCount !== objectKeys.length) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "object_count" });
  }
  const chartObjects = objectKeys.filter((key) => !key.includes("/progress/"));
  const progressObjects = objectKeys.filter((key) => key.includes("/progress/"));
  if (manifest.expectedChartObjectCount !== chartObjects.length
    || manifest.expectedProgressImageObjectCount !== progressObjects.length) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "object_kind_count" });
  }
  if (manifest.guards?.exactIdsOnly !== true
    || manifest.guards?.wildcardDeleteAllowed !== false
    || (fullPurge && manifest.guards?.fullInventory !== true)) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "manifest", { reason: "guards" });
  }
  return manifest;
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

export function buildAllChartPurgeArtifacts({
  manifestId,
  createdAt,
  sourceCommit,
  workerVersionId,
  deploymentId,
  d1DatabaseName,
  r2BucketName,
  rows,
  r2Objects
}) {
  const chartIds = sortedUnique(rows.charts.map((row) => row.id));
  const versionIds = sortedUnique(rows.versions.map((row) => row.id));
  const songIds = sortedUnique(rows.songs.map((row) => row.id));
  const withdrawalIds = sortedUnique(rows.version_withdrawals.map((row) => row.id));
  const deleteRequestIds = sortedUnique(rows.delete_requests.map((row) => row.id));
  const chartSet = new Set(chartIds);
  const versionSet = new Set(versionIds);
  const songSet = new Set(songIds);
  const postLogIds = sortedUnique(rows.post_logs
    .filter((row) => chartSet.has(row.chart_id) || versionSet.has(row.version_id))
    .map((row) => row.id));
  const sourceMetadataIds = sortedUnique(rows.version_source_metadata.map((row) => row.version_id));
  const adminTargetIds = new Set([...chartIds, ...versionIds, ...songIds, ...withdrawalIds, ...deleteRequestIds]);
  const adminLogIds = sortedUnique(rows.admin_logs
    .filter((row) => adminTargetIds.has(row.target_id))
    .map((row) => row.id));
  const targetObjects = r2Objects.filter((object) => String(object.key).startsWith("charts/"));
  const exactObjectKeys = sortedUnique(targetObjects.map((object) => object.key));
  const referencedObjectKeys = sortedUnique(rows.versions.flatMap((row) => [row.r2_key, row.progress_image_key]));
  const targetObjectSet = new Set(exactObjectKeys);
  const referencedObjectSet = new Set(referencedObjectKeys);
  const r2OrphanObjectKeys = exactObjectKeys.filter((key) => !referencedObjectSet.has(key));
  const r2MissingReferencedKeys = referencedObjectKeys.filter((key) => !targetObjectSet.has(key));
  const outsidePrefixCounts = Object.entries(r2Objects
    .filter((object) => !String(object.key).startsWith("charts/"))
    .reduce((counts, object) => {
      const prefix = String(object.key).split("/")[0] || "(root)";
      counts[prefix] = (counts[prefix] ?? 0) + 1;
      return counts;
    }, {}))
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((left, right) => left.prefix.localeCompare(right.prefix));
  const relatedRowIdsByTable = {
    charts: chartIds,
    versions: versionIds,
    songs: songIds,
    version_withdrawals: withdrawalIds,
    delete_requests: deleteRequestIds,
    post_logs: postLogIds,
    version_source_metadata: sourceMetadataIds,
    admin_logs: adminLogIds,
    bans: []
  };
  const expectedRowCountsByTable = Object.fromEntries(
    Object.entries(relatedRowIdsByTable).map(([table, ids]) => [table, ids.length])
  );
  const inventory = {
    schemaVersion: 1,
    manifestId,
    createdAt,
    sourceCommit,
    workerVersionId,
    deploymentId,
    d1DatabaseName,
    r2BucketName,
    counts: {
      charts: chartIds.length,
      versions: versionIds.length,
      songs: songIds.length,
      versionWithdrawals: withdrawalIds.length,
      deleteRequests: deleteRequestIds.length,
      sourceMetadata: sourceMetadataIds.length,
      targetPostLogs: postLogIds.length,
      targetAdminLogs: adminLogIds.length,
      r2ChartFiles: exactObjectKeys.filter((key) => !key.includes("/progress/")).length,
      r2ProgressImages: exactObjectKeys.filter((key) => key.includes("/progress/")).length,
      r2UnrelatedObjects: r2Objects.length - exactObjectKeys.length
    },
    ids: {
      songIds,
      chartIds,
      versionIds,
      withdrawalIds,
      deleteRequestIds,
      sourceMetadataIds,
      postLogIds,
      adminLogIds
    },
    versionRelationships: rows.versions.map((row) => ({
      id: row.id,
      chartId: row.chart_id,
      parentVersionId: row.parent_version_id,
      collapsedByVersionId: row.collapsed_by_version_id
    })),
    orphanChecks: {
      chartsMissingSong: rows.charts.filter((row) => !songSet.has(row.song_id)).map((row) => row.id),
      versionsMissingChart: rows.versions.filter((row) => !chartSet.has(row.chart_id)).map((row) => row.id),
      versionsMissingParent: rows.versions.filter((row) => row.parent_version_id && !versionSet.has(row.parent_version_id)).map((row) => row.id),
      versionsMissingCollapsedReference: rows.versions.filter((row) => row.collapsed_by_version_id && !versionSet.has(row.collapsed_by_version_id)).map((row) => row.id),
      withdrawalsMissingTarget: rows.version_withdrawals.filter((row) => !chartSet.has(row.chart_id) || !versionSet.has(row.version_id)).map((row) => row.id),
      deleteRequestsMissingTarget: rows.delete_requests.filter((row) => !chartSet.has(row.chart_id) || !versionSet.has(row.version_id)).map((row) => row.id),
      sourceMetadataMissingVersion: rows.version_source_metadata.filter((row) => !versionSet.has(row.version_id)).map((row) => row.version_id),
      r2OrphanObjectKeys,
      r2MissingReferencedKeys,
      foreignKeyViolations: rows.foreign_key_check
    },
    r2ExactObjects: targetObjects,
    r2UnrelatedPrefixCounts: outsidePrefixCounts
  };
  const candidateText = [
    "ALL_CHART_DATA_PURGE",
    `manifest_id=${manifestId}`,
    `source_commit=${sourceCommit}`,
    `chart_count=${chartIds.length}`,
    `version_count=${versionIds.length}`,
    `song_count=${songIds.length}`,
    `r2_object_count=${exactObjectKeys.length}`,
    "[chart_ids]",
    ...chartIds,
    "[version_ids]",
    ...versionIds,
    "[song_ids]",
    ...songIds,
    "[r2_exact_object_keys]",
    ...exactObjectKeys,
    ""
  ].join("\r\n");
  const manifest = {
    schemaVersion: 1,
    manifestId,
    createdAt,
    sourceCommit,
    workerVersionId,
    deploymentId,
    d1DatabaseName,
    r2BucketName,
    purgeScope: "all_chart_data",
    approvalSource: "explicit_all_chart_data_request",
    approvalState: "APPROVED",
    approvedAt: createdAt,
    approvedCandidateFileSha256: sha256Hex(Buffer.from(candidateText, "utf8")),
    chartIds,
    versionIds,
    songIds,
    withdrawalIds,
    deleteRequestIds,
    relatedRowIdsByTable,
    r2ExactObjectKeys: exactObjectKeys,
    r2ExactObjects: targetObjects,
    expectedRowCountsByTable,
    expectedObjectCount: exactObjectKeys.length,
    expectedChartObjectCount: exactObjectKeys.filter((key) => !key.includes("/progress/")).length,
    expectedProgressImageObjectCount: exactObjectKeys.filter((key) => key.includes("/progress/")).length,
    keepChartIds: [],
    keepVersionIds: [],
    candidateChartIds: chartIds,
    candidateVersionIds: versionIds,
    candidateRelatedRows: relatedRowIdsByTable,
    guards: {
      exactIdsOnly: true,
      wildcardDeleteAllowed: false,
      fullInventory: true
    }
  };
  return {
    alreadyEmpty: chartIds.length === 0 || versionIds.length === 0,
    inventory,
    manifest,
    candidateText
  };
}

function placeholders(count) {
  if (!Number.isInteger(count) || count < 1) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "sql", { reason: "empty_placeholders" });
  }
  return Array.from({ length: count }, () => "?").join(",");
}

function relationPredicate(columns, chartIds, versionIds) {
  return {
    sql: `(${columns.chart} IN (${placeholders(chartIds.length)}) OR ${columns.version} IN (${placeholders(versionIds.length)}))`,
    params: [...chartIds, ...versionIds]
  };
}

function targetGuard(name, relationSql, relationParams, idColumn, exactIds, expected) {
  const exactSql = exactIds.length > 0
    ? `(SELECT COUNT(*) FROM ${name} WHERE ${idColumn} IN (${placeholders(exactIds.length)})) = ${expected}`
    : `${expected} = 0`;
  return {
    kind: "guard",
    table: name,
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM ${name} WHERE ${relationSql}) = ${expected} AND ${exactSql} THEN 1 ELSE json_extract('INVALID_TARGET','$.guard') END AS guard`,
    params: [...relationParams, ...exactIds]
  };
}

function exactGuard(table, column, ids, expected) {
  const predicate = ids.length > 0
    ? `${column} IN (${placeholders(ids.length)})`
    : "0";
  return {
    kind: "guard",
    table,
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM ${table} WHERE ${predicate}) = ${expected} THEN 1 ELSE json_extract('INVALID_TARGET','$.guard') END AS guard`,
    params: [...ids]
  };
}

function totalGuard(table, expected) {
  return {
    kind: "guard",
    table,
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM ${table}) = ${expected} THEN 1 ELSE json_extract('FULL_INVENTORY_CHANGED','$.guard') END AS guard`,
    params: []
  };
}

function exactDelete(table, column, ids) {
  if (ids.length === 0) return null;
  return {
    kind: "delete",
    table,
    expectedChanges: ids.length,
    sql: `DELETE FROM ${table} WHERE ${column} IN (${placeholders(ids.length)})`,
    params: [...ids]
  };
}

function postCountGuard(table, expected) {
  return {
    kind: "guard_after",
    table,
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM ${table}) = ${expected} THEN 1 ELSE json_extract('INVALID_POST_COUNT','$.guard') END AS guard`,
    params: []
  };
}

export function computeVersionDeleteOrder(versionRows) {
  const rows = asArray(versionRows, "versionRows", PURGE_ERROR_CODES.targetChanged);
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== rows.length || rows.some((row) => !ID_PATTERNS.versions.test(String(row.id ?? "")))) {
    fail(PURGE_ERROR_CODES.targetChanged, "version-order", { reason: "invalid_rows" });
  }
  const depth = new Map();
  const visit = (id, stack = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) fail(PURGE_ERROR_CODES.targetChanged, "version-order", { reason: "cycle" });
    stack.add(id);
    const row = rows.find((candidate) => candidate.id === id);
    const parent = row?.parent_version_id;
    const value = parent && ids.has(parent) ? visit(parent, stack) + 1 : 0;
    stack.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const id of ids) visit(id);
  return [...ids].sort((left, right) => depth.get(right) - depth.get(left) || left.localeCompare(right));
}

export function buildD1Batch(manifest, snapshot) {
  validateManifest(manifest);
  if (!snapshot || typeof snapshot !== "object") {
    fail(PURGE_ERROR_CODES.targetChanged, "snapshot", { reason: "missing" });
  }
  assertTargetUnchanged(manifest, snapshot);
  const chartIds = manifest.chartIds;
  const versionIds = manifest.versionIds;
  const related = manifest.relatedRowIdsByTable;
  const counts = manifest.expectedRowCountsByTable;
  const fullPurge = manifest.purgeScope === "all_chart_data";
  const adminTargets = [...new Set([
    ...chartIds,
    ...versionIds,
    ...(fullPurge ? manifest.songIds : []),
    ...related.version_withdrawals,
    ...related.delete_requests
  ])];
  const versionOrder = computeVersionDeleteOrder(snapshot.versionRows);
  const statements = [];

  statements.push(exactGuard("charts", "id", related.charts, counts.charts));
  const versionRelation = relationPredicate({ chart: "chart_id", version: "id" }, chartIds, versionIds);
  statements.push(fullPurge
    ? exactGuard("versions", "id", related.versions, counts.versions)
    : targetGuard("versions", versionRelation.sql, versionRelation.params, "id", related.versions, counts.versions));
  const withdrawalRelation = relationPredicate({ chart: "chart_id", version: "version_id" }, chartIds, versionIds);
  statements.push(fullPurge
    ? exactGuard("version_withdrawals", "id", related.version_withdrawals, counts.version_withdrawals)
    : targetGuard("version_withdrawals", withdrawalRelation.sql, withdrawalRelation.params, "id", related.version_withdrawals, counts.version_withdrawals));
  const requestRelation = relationPredicate({ chart: "chart_id", version: "version_id" }, chartIds, versionIds);
  statements.push(fullPurge
    ? exactGuard("delete_requests", "id", related.delete_requests, counts.delete_requests)
    : targetGuard("delete_requests", requestRelation.sql, requestRelation.params, "id", related.delete_requests, counts.delete_requests));
  const postRelation = fullPurge
    ? { sql: "(chart_id IN (SELECT id FROM charts) OR version_id IN (SELECT id FROM versions))", params: [] }
    : relationPredicate({ chart: "chart_id", version: "version_id" }, chartIds, versionIds);
  statements.push(targetGuard("post_logs", postRelation.sql, postRelation.params, "id", related.post_logs, counts.post_logs));
  statements.push(exactGuard("version_source_metadata", "version_id", related.version_source_metadata, counts.version_source_metadata));
  statements.push(exactGuard("admin_logs", "id", related.admin_logs, counts.admin_logs));
  statements.push(exactGuard("songs", "id", related.songs, counts.songs));
  if (fullPurge) {
    for (const table of ["charts", "versions", "songs", "version_withdrawals", "delete_requests", "version_source_metadata"]) {
      statements.push(totalGuard(table, counts[table]));
    }
  }
  statements.push(fullPurge ? {
    kind: "guard",
    table: "versions",
    sql: "SELECT 1 AS guard",
    params: []
  } : {
    kind: "guard",
    table: "versions",
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM versions WHERE chart_id NOT IN (${placeholders(chartIds.length)}) AND (parent_version_id IN (${placeholders(versionIds.length)}) OR collapsed_by_version_id IN (${placeholders(versionIds.length)}))) = 0 THEN 1 ELSE json_extract('EXTERNAL_REFERENCE','$.guard') END AS guard`,
    params: [...chartIds, ...versionIds, ...versionIds]
  });
  for (const songId of fullPurge ? [] : related.songs) {
    statements.push({
      kind: "guard",
      table: "songs",
      sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM charts WHERE song_id = ?) = 1 AND (SELECT COUNT(*) FROM charts WHERE song_id = ? AND id IN (${placeholders(related.charts.length)})) = 1 THEN 1 ELSE json_extract('SONG_SHARE_CHANGED','$.guard') END AS guard`,
      params: [songId, songId, ...related.charts]
    });
  }
  statements.push(fullPurge ? targetGuard(
    "admin_logs",
    "target_id IN (SELECT id FROM charts) OR target_id IN (SELECT id FROM versions) OR target_id IN (SELECT id FROM songs) OR target_id IN (SELECT id FROM version_withdrawals) OR target_id IN (SELECT id FROM delete_requests)",
    [],
    "id",
    related.admin_logs,
    counts.admin_logs
  ) : {
    kind: "guard",
    table: "admin_logs",
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM admin_logs WHERE target_id IN (${placeholders(adminTargets.length)})) = ${counts.admin_logs} THEN 1 ELSE json_extract('ADMIN_LOG_TARGET_CHANGED','$.guard') END AS guard`,
    params: adminTargets
  });

  statements.push(exactDelete("version_source_metadata", "version_id", related.version_source_metadata));
  statements.push(exactDelete("version_withdrawals", "id", related.version_withdrawals));
  statements.push(exactDelete("delete_requests", "id", related.delete_requests));
  statements.push(exactDelete("post_logs", "id", related.post_logs));
  statements.push(exactDelete("admin_logs", "id", related.admin_logs));
  for (const versionId of versionOrder) {
    statements.push({
      kind: "delete",
      table: "versions",
      expectedChanges: 1,
      sql: "DELETE FROM versions WHERE id = ?",
      params: [versionId]
    });
  }
  statements.push(exactDelete("charts", "id", related.charts));
  statements.push(exactDelete("songs", "id", related.songs));

  for (const table of TABLE_KEYS) {
    const baseline = Number(snapshot.baselineCounts?.[table]);
    if (!Number.isInteger(baseline) || baseline < counts[table]) {
      fail(PURGE_ERROR_CODES.targetChanged, "snapshot", { table, reason: "baseline_count" });
    }
    statements.push(postCountGuard(table, baseline - counts[table]));
  }
  statements.push({
    kind: "guard_after",
    table: "foreign_key_check",
    sql: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE json_extract('FOREIGN_KEY_CHECK_FAILED','$.guard') END AS guard",
    params: []
  });

  const batch = statements.filter(Boolean);
  assertSqlSafety(batch);
  return batch;
}

export function summarizeVerifiedD1Changes(manifest, { postStateVerified }) {
  validateManifest(manifest);
  if (postStateVerified !== true) {
    fail(PURGE_ERROR_CODES.d1Failed, "d1-summary", { reason: "post_state_not_verified" });
  }
  const changesByTable = { ...manifest.expectedRowCountsByTable };
  return {
    changesByTable,
    totalChanges: Object.values(changesByTable).reduce((total, count) => total + count, 0)
  };
}

export function assertPostDeleteBaselineCounts({
  actualCounts,
  baselineCounts,
  deletedCounts,
  allowPreservedTableGrowth = false
}) {
  const preservedTables = new Set(["post_logs", "admin_logs", "bans"]);
  for (const table of Object.keys(baselineCounts)) {
    const expected = Number(baselineCounts[table]) - Number(deletedCounts[table]);
    const actual = Number(actualCounts[table]);
    const valid = allowPreservedTableGrowth && preservedTables.has(table)
      ? actual >= expected
      : actual === expected;
    if (!valid) {
      fail(PURGE_ERROR_CODES.verifyFailed, "d1-verify", { table, reason: "outside_count" });
    }
  }
  return true;
}

function sameSet(actual, expected) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function assertTargetUnchanged(manifest, snapshot) {
  const related = manifest.relatedRowIdsByTable;
  const checks = [
    [snapshot.chartIds, related.charts, "charts"],
    [snapshot.versionRows?.map((row) => row.id), related.versions, "versions"],
    [snapshot.songIds, related.songs, "songs"],
    [snapshot.withdrawalIds, related.version_withdrawals, "version_withdrawals"],
    [snapshot.deleteRequestIds, related.delete_requests, "delete_requests"],
    [snapshot.postLogIds, related.post_logs, "post_logs"],
    [snapshot.sourceMetadataVersionIds, related.version_source_metadata, "version_source_metadata"],
    [snapshot.adminLogIds, related.admin_logs, "admin_logs"]
  ];
  for (const [actual = [], expected, table] of checks) {
    if (!sameSet(actual, expected)) {
      fail(PURGE_ERROR_CODES.targetChanged, "target", { table });
    }
  }
  if (Number(snapshot.externalReferenceCount ?? 0) !== 0
    || (manifest.purgeScope !== "all_chart_data"
      && snapshot.songChartCounts?.some((entry) => Number(entry.chart_count) !== 1))) {
    fail(PURGE_ERROR_CODES.targetChanged, "target", { reason: "dependencies" });
  }
  if (snapshot.keepChartCount !== undefined
    && Number(snapshot.keepChartCount) !== manifest.keepChartIds.length) {
    fail(PURGE_ERROR_CODES.targetChanged, "target", { reason: "keep_charts" });
  }
  if (snapshot.keepVersionCount !== undefined
    && Number(snapshot.keepVersionCount) !== manifest.keepVersionIds.length) {
    fail(PURGE_ERROR_CODES.targetChanged, "target", { reason: "keep_versions" });
  }
  return true;
}

export function assertR2TargetUnchanged(manifest, objectKeys) {
  if (!sameSet(objectKeys, manifest.r2ExactObjectKeys)) {
    fail(PURGE_ERROR_CODES.targetChanged, "r2", { reason: "object_set" });
  }
  return true;
}

export function encodeR2ObjectKey(key) {
  if (typeof key !== "string" || key.length === 0 || /[*?\[\]]/u.test(key)) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "r2", { reason: "invalid_key" });
  }
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function assertSqlSafety(statements) {
  const list = asArray(statements, "statements");
  for (const statement of list) {
    const sql = String(statement?.sql ?? "");
    if (/\b(?:LIKE|DROP\s+TABLE|VACUUM)\b/iu.test(sql)) {
      fail(PURGE_ERROR_CODES.manifestInvalid, "sql", { reason: "forbidden_sql" });
    }
    if (/^\s*DELETE\s+FROM\b/iu.test(sql) && !/\bWHERE\b/iu.test(sql)) {
      fail(PURGE_ERROR_CODES.manifestInvalid, "sql", { reason: "delete_without_where" });
    }
  }
  return true;
}

function localRows(database, sql, params = []) {
  return database.prepare(sql).all(...params);
}

function localPlaceholders(values) {
  return values.length > 0 ? values.map(() => "?").join(",") : "NULL";
}

export function inspectLocalSnapshot(database, manifest) {
  validateManifest(manifest);
  const related = manifest.relatedRowIdsByTable;
  const adminTargets = [...new Set([
    ...manifest.chartIds,
    ...manifest.versionIds,
    ...related.version_withdrawals,
    ...related.delete_requests
  ])];
  const relation = (table) => localRows(
    database,
    `SELECT id FROM ${table} WHERE chart_id IN (${localPlaceholders(manifest.chartIds)}) OR version_id IN (${localPlaceholders(manifest.versionIds)}) ORDER BY id`,
    [...manifest.chartIds, ...manifest.versionIds]
  );
  const chartRows = localRows(database, `SELECT id FROM charts WHERE id IN (${localPlaceholders(manifest.chartIds)}) ORDER BY id`, manifest.chartIds);
  const versionRows = localRows(
    database,
    `SELECT id,chart_id,parent_version_id,collapsed_by_version_id FROM versions WHERE chart_id IN (${localPlaceholders(manifest.chartIds)}) OR id IN (${localPlaceholders(manifest.versionIds)}) ORDER BY id`,
    [...manifest.chartIds, ...manifest.versionIds]
  );
  const songRows = localRows(database, `SELECT id FROM songs WHERE id IN (${localPlaceholders(manifest.songIds)}) ORDER BY id`, manifest.songIds);
  const withdrawalRows = relation("version_withdrawals");
  const requestRows = relation("delete_requests");
  const postRows = relation("post_logs");
  const sourceRows = localRows(database, `SELECT version_id FROM version_source_metadata WHERE version_id IN (${localPlaceholders(manifest.versionIds)}) ORDER BY version_id`, manifest.versionIds);
  const adminRows = localRows(database, `SELECT id FROM admin_logs WHERE target_id IN (${localPlaceholders(adminTargets)}) ORDER BY id`, adminTargets);
  const externalReferences = localRows(
    database,
    `SELECT id FROM versions WHERE chart_id NOT IN (${localPlaceholders(manifest.chartIds)}) AND (parent_version_id IN (${localPlaceholders(manifest.versionIds)}) OR collapsed_by_version_id IN (${localPlaceholders(manifest.versionIds)}))`,
    [...manifest.chartIds, ...manifest.versionIds, ...manifest.versionIds]
  );
  const songChartCounts = manifest.songIds.map((songId) => ({
    song_id: songId,
    chart_count: Number(database.prepare("SELECT COUNT(*) AS count FROM charts WHERE song_id = ?").get(songId)?.count ?? 0)
  }));
  return {
    chartIds: chartRows.map((row) => row.id),
    versionRows,
    songIds: songRows.map((row) => row.id),
    withdrawalIds: withdrawalRows.map((row) => row.id),
    deleteRequestIds: requestRows.map((row) => row.id),
    postLogIds: postRows.map((row) => row.id),
    sourceMetadataVersionIds: sourceRows.map((row) => row.version_id),
    adminLogIds: adminRows.map((row) => row.id),
    externalReferenceCount: externalReferences.length,
    songChartCounts,
    keepChartCount: Number(database.prepare(`SELECT COUNT(*) AS count FROM charts WHERE id IN (${localPlaceholders(manifest.keepChartIds)})`).get(...manifest.keepChartIds)?.count ?? 0),
    keepVersionCount: Number(database.prepare(`SELECT COUNT(*) AS count FROM versions WHERE id IN (${localPlaceholders(manifest.keepVersionIds)})`).get(...manifest.keepVersionIds)?.count ?? 0),
    baselineCounts: Object.fromEntries(TABLE_KEYS.map((table) => [
      table,
      Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0)
    ])),
    foreignKeyViolationCount: localRows(database, "PRAGMA foreign_key_check").length
  };
}

export function applySqlBatchLocally(database, batch) {
  assertSqlSafety(batch);
  database.exec("BEGIN IMMEDIATE;");
  const results = [];
  try {
    for (const statement of batch) {
      const prepared = database.prepare(statement.sql);
      const result = /^\s*(?:SELECT|PRAGMA)\b/iu.test(statement.sql)
        ? prepared.all(...statement.params)
        : prepared.run(...statement.params);
      if (statement.kind === "delete" && Number(result.changes) !== statement.expectedChanges) {
        throw new Error("LOCAL_DELETE_CHANGE_MISMATCH");
      }
      results.push(result);
    }
    database.exec("COMMIT;");
    return results;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function runGuardedLocalD1Apply({ database, manifest, snapshot = null, backupReady }) {
  if (!backupReady) fail(PURGE_ERROR_CODES.backupFailed, "backup", { reason: "not_ready" });
  const batch = buildD1Batch(manifest, snapshot ?? inspectLocalSnapshot(database, manifest));
  return applySqlBatchLocally(database, batch);
}

export async function deleteExactR2Objects({
  keys,
  deleteObject,
  objectExists,
  maxAttempts = 3,
  retryDelayMs = 0,
  shouldRetry = () => true,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string" || /[*?]/u.test(key))) {
    fail(PURGE_ERROR_CODES.manifestInvalid, "r2", { reason: "invalid_keys" });
  }
  const deleted = [];
  const failures = [];
  let attemptCount = 0;
  for (const key of keys) {
    let lastCode = "R2_DELETE_FAILED";
    let complete = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        attemptCount += 1;
        await deleteObject(key);
        if (await objectExists(key)) throw new Error("R2_OBJECT_STILL_EXISTS");
        deleted.push(key);
        complete = true;
        break;
      } catch (error) {
        lastCode = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : "R2_DELETE_FAILED";
        try {
          if (!(await objectExists(key))) {
            deleted.push(key);
            complete = true;
            break;
          }
        } catch {
          lastCode = "R2_VERIFY_FAILED";
        }
        if (!complete && attempt < maxAttempts && shouldRetry(lastCode) && retryDelayMs > 0) {
          await wait(retryDelayMs * (2 ** (attempt - 1)));
        } else if (!complete && !shouldRetry(lastCode)) {
          break;
        }
      }
    }
    if (!complete) failures.push({ key, code: lastCode });
  }
  return { deleted, failures, attemptCount, orphanPlan: buildOrphanPlan(failures) };
}

export function buildOrphanPlan(failures) {
  return failures.map((failure) => ({ key: failure.key, action: "RETRY_EXACT_DELETE", code: failure.code }));
}

export function assertSafeLogText(text) {
  if (SENSITIVE_LOG_PATTERN.test(String(text))) {
    fail(PURGE_ERROR_CODES.verifyFailed, "log-safety", { reason: "sensitive_value" });
  }
  return true;
}

export function buildRestorePlanText({ manifestId, d1BackupPath, r2BackupPath }) {
  return [
    "TEST-DATA-BULK-PURGE-01 restore plan",
    `manifest ID: ${manifestId}`,
    "自動restoreは禁止。復旧が必要な場合は追加writeを停止する。",
    `D1 backup: ${d1BackupPath}`,
    `R2 backup: ${r2BackupPath}`,
    "1. full D1 SQL exportとtarget snapshotの整合を確認する。",
    "2. Cloudflare D1 import手順を別途dry-runし、対象外rowを変更しないrestore SQLを作る。",
    "3. R2 object mappingのexact keyへ対応するbytesとmetadataだけを復元する。",
    "4. D1 FK check、対象row、R2 size、公開API、管理APIをread-only検証する。",
    "5. 誤削除または検証失敗時は追加writeを行わず停止する。"
  ].join("\r\n");
}

export function safeErrorRecord(error, fallbackCode) {
  return {
    code: error instanceof TestDataPurgeError ? error.code : fallbackCode,
    stage: error instanceof TestDataPurgeError ? error.stage : "unexpected"
  };
}
